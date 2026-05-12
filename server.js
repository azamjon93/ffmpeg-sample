const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const UDP_PORT = 9999;
const RECORD_DIR = path.join(__dirname, 'recordings');

if (!fs.existsSync(RECORD_DIR)) {
    fs.mkdirSync(RECORD_DIR);
}

app.use(express.static('public'));

// Command endpoints for recording
app.get('/record/start', (req, res) => {
    startRecording();
    res.sendStatus(200);
});

app.get('/record/stop', (req, res) => {
    stopRecording();
    res.sendStatus(200);
});

let ffmpegStreaming = null;
let ffmpegRecording = null;
let activeClients = 0;

wss.on('connection', (ws) => {
    console.log('Client connected');
    activeClients++;

    // For mpegts.js, we start streaming immediately on connection
    startStreaming(ws);

    ws.on('close', () => {
        console.log('Client disconnected');
        activeClients--;
        if (activeClients === 0) {
            stopStreaming();
        }
    });
});

function startStreaming(ws) {
    if (ffmpegStreaming) {
        // Already streaming, just pipe to this new client
        ffmpegStreaming.stdout.on('data', (chunk) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
        });
        return;
    }

    console.log(`Starting FFmpeg MPEG-TS transcode on port ${UDP_PORT}`);

    // Switching to MPEG-TS output (-f mpegts)
    // MPEG-TS is much more resilient to corruption than MP4
    // Scale to 480p for real-time speed (>1.0x) on low-spec servers
    // Increase keyframe frequency (-g 15) to help recovery from corruption
    // Use CRF 20 to maintain quality even with dirty input
    ffmpegStreaming = spawn('ffmpeg', [
        '-analyzeduration', '10000000',
        '-probesize', '10000000',
        '-fflags', '+genpts+igndts',
        '-i', `udp://0.0.0.0:${UDP_PORT}?fifo_size=10000000&buffer_size=10000000`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-vf', 'scale=trunc(oh*a/2)*2:480', // Force width to be divisible by 2 for H.264 encoder
        '-crf', '20',         
        '-g', '15',           
        '-pix_fmt', 'yuv420p',
        '-threads', '0',      
        '-c:a', 'aac',
        '-f', 'mpegts',
        'pipe:1'
    ]);

    ffmpegStreaming.stdout.on('data', (chunk) => {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(chunk);
            }
        });
    });

    ffmpegStreaming.stderr.on('data', (data) => {
        console.log(`FFmpeg: ${data}`);
    });

    ffmpegStreaming.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        ffmpegStreaming = null;
    });
}

function stopStreaming() {
    if (ffmpegStreaming) {
        ffmpegStreaming.kill('SIGINT');
        ffmpegStreaming = null;
    }
}

function startRecording() {
    if (ffmpegRecording) return;
    const filePath = path.join(RECORD_DIR, `record_${Date.now()}.mp4`);
    console.log(`Recording to ${filePath}`);
    ffmpegRecording = spawn('ffmpeg', [
        '-i', `udp://0.0.0.0:${UDP_PORT}?reuse=1`,
        '-c', 'copy',
        filePath
    ]);
}

function stopRecording() {
    if (ffmpegRecording) {
        ffmpegRecording.kill('SIGINT');
        ffmpegRecording = null;
    }
}

server.listen(PORT, () => {
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`UDP: ${UDP_PORT}`);
    console.log('TIP: If you still see Packet Corrupt, run: sudo sysctl -w net.core.rmem_max=26214400');
});
