require('dotenv').config();
const fs = require('fs');
const WebSocket = require('ws');

// Converts Float32Array of audio data to PCM16 ArrayBuffer
function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// Converts a Float32Array to base64-encoded PCM16 data
function base64EncodeAudio(float32Array) {
  const arrayBuffer = floatTo16BitPCM(float32Array);
  let binary = '';
  let bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000; // 32KB chunk size
  for (let i = 0; i < bytes.length; i += chunkSize) {
    let chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

(async () => {
  const { default: decodeAudio } = await import('audio-decode');
  const wavDecoder = await import('wav-decoder');

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
  const ws = new WebSocket(url, {
    headers: {
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  ws.on('open', async function open() {
    console.log('Connected to server.');

    // Paths to your audio files
    const files = [
      './audio/1.wav',
    ];

    for (const filename of files) {
      try {
        const audioFile = fs.readFileSync(filename);
        const audioBuffer = await decodeAudio(audioFile, { decode: wavDecoder.decode });
        const channelData = audioBuffer.getChannelData(0);
        const base64Chunk = base64EncodeAudio(channelData);
        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64Chunk
        }));
      } catch (error) {
        console.error('Error processing file:', filename, error);
      }
    }

    ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    ws.send(JSON.stringify({ type: 'response.create' }));
  });

  ws.on('message', function incoming(message) {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received message:', data);
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('error', function error(error) {
    console.error('WebSocket error:', error);
  });

  ws.on('close', function close(code, reason) {
    console.log('WebSocket closed:', code, reason);
  });
})();
