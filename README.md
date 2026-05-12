# FFmpeg UDP Listener Setup & Testing

This project provides a Node.js server that listens for UDP streams and relays them to a web browser using WebSockets and MediaSource Extensions (MSE).

## 1. Installation (on Ubuntu Server)

1.  Ensure Node.js and FFmpeg are installed:
    ```bash
    sudo apt update
    sudo apt install nodejs npm ffmpeg
    ```
2.  Install project dependencies:
    ```bash
    npm install
    ```

## 2. Start the Server

Run the following command in the project directory:
```bash
node server.js
```
The server will start on `http://localhost:3000` (or the IP of your Ubuntu server).

## 3. Testing from Windows

To test the listener, you can send a synthetic stream from your Windows machine using FFmpeg. Replace `<SERVER_IP>` with the IP address of your Ubuntu server.

### Test Case: Video + Audio (Synthetic)
This command generates a test pattern and a sine wave, encodes them as H264/AAC, and sends them via UDP.

```powershell
ffmpeg -re -f lavfi -i "testsrc=size=1280x720:rate=30" -f lavfi -i "sine=f=440:beep_factor=4" -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -c:a aac -f mpegts udp://<SERVER_IP>:9999
```

### Test Case: Desktop Capture (Windows GDI)
To stream your Windows display:
```powershell
ffmpeg -f gdigrab -framerate 30 -i desktop -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -f mpegts udp://<SERVER_IP>:9999
```

### Test Case: Microphone Capture (Windows dshow)
First, find your device names: `ffmpeg -list_devices true -f dshow -i dummy`.
Then stream:
```powershell
ffmpeg -f dshow -i audio="Your Microphone Name" -c:a aac -f mpegts udp://<SERVER_IP>:9999
```

## 4. Web Interface Usage

1.  Open `http://<SERVER_IP>:3000` in a Chrome or Edge browser.
2.  Click **Connect Stream**. The video player should start showing the incoming UDP stream.
3.  Click **Start Recording** to save the stream to the `recordings/` folder on the server.
4.  Click **Stop Recording** to finalize the file.

## Notes for Server Developer
-   **Codec Sensitivity**: The frontend MSE player in `index.html` uses a hardcoded codec string: `video/mp4; codecs="avc1.42E01E, mp4a.40.2"`. If the Windows app sends different profiles, this may need to be adjusted or dynamically detected.
-   **Fragmentation**: FFmpeg on the server uses `-movflags frag_keyframe+empty_moov+default_base_moof` to ensure the MP4 stream is playable in real-time by the browser.
-   **Concurrency**: Currently, the server binds to port `9999`. For multiple concurrent streams, a port management system would be required.
