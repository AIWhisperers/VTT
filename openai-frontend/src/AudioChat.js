// src/AudioChat.js

import React, { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Buffer } from 'buffer';
import './AudioChat.css'; 

const AudioChat = () => {
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const canvasRef = useRef(null);

  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const socketRef = useRef(null);
  const mediaStreamRef = useRef(null);

  // References for managing audio playback
  const assistantAudioRef = useRef(null); // To keep track of the current assistant audio
  const audioQueueRef = useRef([]); // Queue for assistant audio responses
  const audioChunksRef = useRef([]); // To store incoming audio chunks

  // Initialize Buffer globally
  useEffect(() => {
    window.Buffer = Buffer;
  }, []);

  // Initialize WebSocket connection when conversation starts
  useEffect(() => {
    if (isConversationActive) {
      initSocket();
      startRecording();
    }

    return () => {
      // Cleanup on unmount
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (isConversationActive) {
        stopRecording();
      }
    };
  }, [isConversationActive]);

  // Initialize WebSocket connection
  const initSocket = () => {
    socketRef.current = io('http://localhost:8080');

    socketRef.current.on('connect', () => {
      console.log('Connected to backend WebSocket');
      setStatusMessage('Connected to backend server.');
    });

    // Handle assistant audio chunks
    socketRef.current.on('assistant_audio_chunk', (data) => {
      console.log('Received assistant_audio_chunk:', data.audio.length, 'characters');
      // Append incoming audio chunks
      audioChunksRef.current.push(data.audio);
    });

    // Handle when assistant audio is done
    socketRef.current.on('assistant_audio_done', () => {
      console.log('Received assistant_audio_done');
      // Play the concatenated audio when done
      playAssistantAudio(audioChunksRef.current);
      audioChunksRef.current = []; // Reset buffer
    });

    // Handle text responses
    socketRef.current.on('assistant_text', (data) => {
      console.log('Assistant:', data.text);
      // Optionally, you can display the text response
    });

    // Handle errors
    socketRef.current.on('error', (data) => {
      console.error('Error from backend:', data.message);
      setStatusMessage(`Error from backend: ${data.message}`);
    });

    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from backend WebSocket');
      setStatusMessage('Disconnected from backend server.');
    });
  };

  // Start Recording
  const startRecording = async () => {
    if (!navigator.mediaDevices) {
      setStatusMessage('Your browser does not support audio recording.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      source.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      processorRef.current.onaudioprocess = (e) => {
        const channelData = e.inputBuffer.getChannelData(0);
        // Process and send audio data in real-time
        processAudioChunk(channelData);
      };

      setStatusMessage('Recording started. Speak into your microphone.');
      console.log('Recording started');
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setStatusMessage('Could not access your microphone. Please check permissions.');
    }
  };

  // Stop Recording
  const stopRecording = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    setIsConversationActive(false);
    setStatusMessage('Conversation ended.');
    console.log('Conversation stopped');

    // Stop assistant audio playback
    if (assistantAudioRef.current) {
      assistantAudioRef.current.pause();
      assistantAudioRef.current.currentTime = 0;
      assistantAudioRef.current = null;
    }

    // Clear the audio queue
    audioQueueRef.current.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    audioQueueRef.current = [];

    // Disconnect from the backend
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  };

  // Process and send audio chunk
  const processAudioChunk = (channelData) => {
    try {
      // Convert Float32Array to Int16Array (16-bit PCM)
      const int16Buffer = float32ToInt16(channelData);

      // Send raw PCM data as Buffer
      const rawPCM = Buffer.from(int16Buffer.buffer);
      const base64PCM = rawPCM.toString('base64');

      // Send audio chunk to backend
      if (socketRef.current) {
        socketRef.current.emit('input_audio', { audio: base64PCM });
      }
    } catch (error) {
      console.error('Error during audio processing:', error);
      setStatusMessage('An error occurred while processing your audio. Please try again.');
    }
  };

  // Function to convert Float32Array to Int16Array (16-bit PCM)
  const float32ToInt16 = (buffer) => {
    const l = buffer.length;
    const buf = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      let s = Math.max(-1, Math.min(1, buffer[i]));
      buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return buf;
  };

  // Function to play assistant audio
  const playAssistantAudio = async (audioChunks) => {
    try {
      // Decode each base64 chunk and concatenate binary data
      const binaryChunks = audioChunks.map(chunk => base64ToUint8Array(chunk));
      const totalLength = binaryChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const concatenated = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of binaryChunks) {
        concatenated.set(chunk, offset);
        offset += chunk.length;
      }

      console.log('Total assistant audio data length:', concatenated.length);

      // Convert raw PCM to WAV format
      const wavBuffer = encodeWAV(concatenated.buffer);

      // Create a Blob with 'audio/wav' MIME type
      const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(audioBlob);

      // Create a new Audio object
      const audio = new Audio(url);

      // Add audio to the queue
      audioQueueRef.current.push(audio);

      // If this is the only audio in the queue, start playing
      if (audioQueueRef.current.length === 1) {
        playNextInQueue();
      }
    } catch (error) {
      console.error('Error playing assistant audio:', error);
      setStatusMessage("An error occurred while playing the assistant's audio.");
    }
  };

  // Function to play the next audio in the queue
  const playNextInQueue = () => {
    if (audioQueueRef.current.length === 0) return;

    const currentAudio = audioQueueRef.current[0];
    assistantAudioRef.current = currentAudio;

    currentAudio.play();

    currentAudio.onended = () => {
      // Remove the played audio from the queue
      audioQueueRef.current.shift();
      // Play the next audio in the queue
      playNextInQueue();
    };

    currentAudio.onerror = (error) => {
      console.error('Error during audio playback:', error);
      // Remove the errored audio from the queue
      audioQueueRef.current.shift();
      // Play the next audio in the queue
      playNextInQueue();
    };
  };

  // Function to encode PCM data into WAV format
  const encodeWAV = (samples) => {
    const buffer = new ArrayBuffer(44 + samples.byteLength);
    const view = new DataView(buffer);

    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* file length */
    view.setUint32(4, 36 + samples.byteLength, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (PCM) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, 1, true); // Mono channel
    /* sample rate */
    view.setUint32(24, 24000, true); // Ensure this matches the assistant's sample rate
    /* byte rate (sample rate * block align) */
    view.setUint32(28, 24000 * 2, true); // sampleRate * bytesPerSample
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 2, true); // channels * bytesPerSample
    /* bits per sample */
    view.setUint16(34, 16, true); // 16-bit samples
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.byteLength, true);

    // Write the PCM samples
    const pcmData = new Uint8Array(buffer, 44);
    pcmData.set(new Uint8Array(samples));

    return buffer;
  };

  // Helper function to write strings to DataView
  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // Function to convert a single base64 string to Uint8Array
  const base64ToUint8Array = (base64) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  // Audio visualization effect (optional)
  useEffect(() => {
    if (assistantAudioRef.current) {
      assistantAudioRef.current.addEventListener('play', visualizeAudio);
    }
    return () => {
      if (assistantAudioRef.current) {
        assistantAudioRef.current.removeEventListener('play', visualizeAudio);
      }
    };
  }, [assistantAudioRef.current]);

  const visualizeAudio = () => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaElementSource(assistantAudioRef.current);
    const analyser = audioContext.createAnalyser();

    source.connect(analyser);
    analyser.connect(audioContext.destination);

    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');

    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    const draw = () => {
      requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

      const barWidth = (WIDTH / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i];

        // Create a purple holographic gradient for each bar
        const gradient = canvasCtx.createLinearGradient(0, 0, 0, HEIGHT);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(126, 87, 194, 0.8)');
        gradient.addColorStop(1, 'rgba(126, 87, 194, 0.8)');

        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(x, HEIGHT - barHeight / 2, barWidth, barHeight / 2);

        x += barWidth + 1;
      }
    };

    draw();
  };

  // Use a cool word for the button text
  const buttonText = isConversationActive ? 'Silence' : 'Launch';

  return (
    <div className="audio-chat-container">
      <button
        className="start-stop-button"
        onClick={() => {
          if (!isConversationActive) {
            setIsConversationActive(true);
          } else {
            setIsConversationActive(false);
          }
        }}
      >
        {buttonText}
      </button>
      <canvas ref={canvasRef} className="audio-visualizer" width="800" height="300" />
      
      {/* Inline Status Message */}
      {statusMessage && <p className="status-message">{statusMessage}</p>}
    </div>
  );
};

export default AudioChat;
