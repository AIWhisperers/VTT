// server.js

import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { OpenAIClient } from './openaiClient.js';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';

// Configure winston logger
const logger = winston.createLogger({
  level: 'info', 
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    // Add file transports if needed
  ],
});

// Define __filename and __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO server
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3001', 
    methods: ['GET', 'POST'],
  },
});

const PORT = 8080;

io.on('connection', (socket) => {
  logger.info(`New client connected: ${socket.id}`);

  // Instantiate OpenAIClient for this socket connection
  const openAIClient = new OpenAIClient(process.env.OPENAI_API_KEY);

  // Connect to OpenAI's Realtime API
  openAIClient.connect().then(() => {
    logger.info(`Connected to OpenAI Realtime API for client ${socket.id}`);

    // Define event handlers for OpenAI events
    const handleResponseAudioDelta = (event) => {
      const audioChunkBase64 = event.delta; // Verify if 'delta' contains base64
      if (audioChunkBase64) {
        logger.debug(`Sending audio chunk to client ${socket.id}: ${audioChunkBase64.length} characters`);
        socket.emit('assistant_audio_chunk', { audio: audioChunkBase64 });
      } else {
        logger.warn(`Received empty audio chunk from OpenAI for client ${socket.id}`);
      }
    };

    const handleResponseAudioDone = () => {
      logger.debug(`Sending audio done signal to client ${socket.id}`);
      socket.emit('assistant_audio_done');
    };

    const handleResponseDone = (event) => {
      // Extract assistant's text response if available
      if (event.response && event.response.output) {
        event.response.output.forEach((item) => {
          if (item.type === 'message' && item.role === 'assistant') {
            item.content.forEach((contentItem) => {
              if (contentItem.type === 'text' && contentItem.text) {
                socket.emit('assistant_text', { text: contentItem.text });
              }
            });
          }
        });
      }
    };

    const handleTranscriptionCompleted = (event) => {
      // Handle user speech transcription
      if (event.transcription && event.transcription.text) {
        socket.emit('transcript', { text: event.transcription.text });
      }
    };

    const handleAssistantTranscriptDelta = (event) => {
      // Handle assistant's speech-to-text transcription delta
      if (event.delta) {
        socket.emit('assistant_transcript_delta', { text: event.delta });
      }
    };

    const handleAssistantTranscriptDone = () => {
      socket.emit('assistant_transcript_done');
    };

    const handleError = (error) => {
      logger.error(`OpenAI Realtime API Error: ${error.message}`);
      socket.emit('error', { message: error.message });
    };

    const handleClose = ({ code, reason }) => {
      logger.info(`OpenAIClient WebSocket closed: ${code} - ${reason}`);
      socket.emit('openai_connection_closed', { code, reason });
    };

    // Register event handlers with OpenAIClient
    openAIClient.on('response.audio.delta', handleResponseAudioDelta);
    openAIClient.on('response.audio.done', handleResponseAudioDone);
    openAIClient.on('response.done', handleResponseDone);
    openAIClient.on('conversation.item.input_audio_transcription.completed', handleTranscriptionCompleted);
    openAIClient.on('response.audio_transcript.delta', handleAssistantTranscriptDelta);
    openAIClient.on('response.audio_transcript.done', handleAssistantTranscriptDone);
    openAIClient.on('error', handleError);
    openAIClient.on('close', handleClose);

    // Handle incoming audio data from the client
    socket.on('input_audio', (data) => {
      try {
        const { audio } = data; // Base64-encoded raw PCM audio
        if (audio) {
          logger.debug(`Received input_audio from client ${socket.id}: ${audio.length} characters`);
          openAIClient.sendAudioChunk(audio);
        } else {
          logger.warn(`Received empty input_audio from client ${socket.id}`);
        }
      } catch (error) {
        logger.error(`Error processing input_audio: ${error.message}`);
        socket.emit('error', { message: 'Error processing your audio input.' });
      }
    });

    // Handle text input from the client (if applicable)
    socket.on('input_text', (data) => {
      const { text } = data;
      openAIClient.sendUserText(text);
      logger.info(`Received text input from ${socket.id}: ${text}`);
    });

    // Handle client disconnection
    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
      openAIClient.close();
    });

    // Handle socket errors
    socket.on('error', (error) => {
      logger.error(`Socket.IO error: ${error.message}`);
    });
  }).catch((error) => {
    logger.error(`Failed to connect to OpenAI Realtime API: ${error.message}`);
    socket.emit('error', { message: 'Failed to connect to OpenAI Realtime API.' });
  });
});

// Start the server
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
