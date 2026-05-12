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
    if (ffmpegStreaming) return;

    console.log(`Starting FFmpeg High-Quality Pass-through on port ${UDP_PORT}`);

    // Switched to '-c copy' (Pass-through). 
    // This preserves the exact quality sent from Windows and uses almost 0% CPU.
    // We use '-vbsf h264_mp4toannexb' to ensure the bitstream is compatible with MPEG-TS.
    ffmpegStreaming = spawn('ffmpeg', [
        '-fflags', 'nobuffer',
        '-flags', 'low_delay',
        '-analyzeduration', '2000000',
        '-probesize', '2000000',
        '-i', `udp://0.0.0.0:${UDP_PORT}?fifo_size=5000000&buffer_size=5000000`,
        '-c', 'copy',         // No transcoding = Original Quality + 0% CPU
        '-f', 'mpegts',
        '-flush_packets', '1',
        'pipe:1'
    ]);

    ffmpegStreaming.stdout.on('data', (chunk) => {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                // Congestion Control: Drop data if client buffer is > 1MB
                // This prevents latency from growing indefinitely
                if (client.bufferedAmount < 1024 * 1024) {
                    client.send(chunk);
                } else {
                    // console.log('Client buffer full, dropping chunk');
                }
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
