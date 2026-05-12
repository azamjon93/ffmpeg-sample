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

// Ensure recordings directory exists
if (!fs.existsSync(RECORD_DIR)) {
    fs.mkdirSync(RECORD_DIR);
}

app.use(express.static('public'));

let ffmpegStreaming = null;
let ffmpegRecording = null;

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'START_STREAM') {
            startStreaming(ws);
        } else if (data.type === 'STOP_STREAM') {
            stopStreaming();
        } else if (data.type === 'START_RECORD') {
            startRecording();
        } else if (data.type === 'STOP_RECORD') {
            stopRecording();
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        stopStreaming();
        stopRecording();
    });
});

function startStreaming(ws) {
    if (ffmpegStreaming) return;

    console.log(`Starting FFmpeg UDP listener on port ${UDP_PORT}`);

    // FFmpeg command to receive UDP and output fragmented MP4 to stdout
    // -i udp://0.0.0.0:9999 : Listen for UDP on all interfaces
    // -c copy : Copy codecs (no transcoding for low latency)
    // -f mp4 : Output format MP4
    // -movflags frag_keyframe+empty_moov+default_base_moof : Create fragmented MP4 for MSE
    // Switched to transcoding (-c:v libx264) because the input UDP stream is too corrupted for direct copying.
    // Transcoding allows FFmpeg to reconstruct the frames and correctly identify dimensions.
    ffmpegStreaming = spawn('ffmpeg', [
        '-analyzeduration', '10000000',
        '-probesize', '10000000',
        '-fflags', '+genpts+igndts',
        '-i', `udp://0.0.0.0:${UDP_PORT}?fifo_size=10000000&buffer_size=10000000`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-g', '30', // Force keyframe every 30 frames for faster MSE sync
        '-c:a', 'aac',
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        'pipe:1'
    ]);

    ffmpegStreaming.stdout.on('data', (chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(chunk);
        }
    });

    ffmpegStreaming.stderr.on('data', (data) => {
        // Log FFmpeg errors/info
        console.log(`FFmpeg Streaming: ${data}`);
    });

    ffmpegStreaming.on('close', (code) => {
        console.log(`FFmpeg Streaming process exited with code ${code}`);
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

    const fileName = `record_${Date.now()}.mp4`;
    const filePath = path.join(RECORD_DIR, fileName);

    console.log(`Starting recording to ${filePath}`);

    // Spawn a separate FFmpeg process to record the same UDP stream
    // Using -i udp://0.0.0.0:9999 again (FFmpeg can share the socket if needed, 
    // but usually only one process can bind to a port unless SO_REUSEPORT is used).
    // Note: For production, we'd use a single FFmpeg with 'tee' muxer.
    // For this POC, we'll try to re-read or use a different approach if port is locked.
    ffmpegRecording = spawn('ffmpeg', [
        '-i', `udp://0.0.0.0:${UDP_PORT}?reuse=1`,
        '-c', 'copy',
        filePath
    ]);

    ffmpegRecording.on('close', (code) => {
        console.log(`FFmpeg Recording process exited with code ${code}`);
        ffmpegRecording = null;
    });
}

function stopRecording() {
    if (ffmpegRecording) {
        ffmpegRecording.kill('SIGINT');
        ffmpegRecording = null;
    }
}

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Listening for UDP streams on port ${UDP_PORT}`);
});
