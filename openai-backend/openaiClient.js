// openaiClient.js

import winston from 'winston';
import dotenv from 'dotenv';
dotenv.config();
import WebSocket from 'ws';
import { Buffer } from 'buffer';

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
  ],
});

export class OpenAIClient {
  constructor(apiKey, modelName = 'gpt-4o-realtime-preview-2024-10-01') {
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.ws = null;
    this.eventHandlers = {}; 
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${this.modelName}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.on('open', () => {
        logger.info('Connected to OpenAI Realtime API.');

        // Update session parameters
        const sessionUpdate = {
          type: 'session.update',
          session: {
            // instructions: 'You are a helpful assistant.',
            instructions: 'You are a helpful assistant that responds in English, unless the user asks you directly.',
            voice: 'coral',
            output_audio_format: 'pcm16',
            turn_detection: { type: 'server_vad' }, // Use server-side VAD
            input_audio_transcription: { model: 'whisper-1' },
          },
        };
        this.ws.send(JSON.stringify(sessionUpdate));
        logger.info('Sent session.update message.');
        resolve();
      });

      this.ws.on('message', (data) => {
        const event = JSON.parse(data);
        this.handleEvent(event);
      });

      this.ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
        this.emit('error', error);
      });

      this.ws.on('close', (code, reason) => {
        logger.info(`WebSocket closed: ${code} - ${reason}`);
        this.emit('close', { code, reason });
      });
    });
  }

  handleEvent(event) {
    logger.info(`Received event: ${JSON.stringify(event)}`);
    switch (event.type) {
      case 'conversation.updated':
        this.emit('conversation.updated', event);
        break;
      case 'response.audio.delta':
        this.emit('response.audio.delta', event);
        break;
      case 'response.audio.done':
        this.emit('response.audio.done', event);
        break;
      case 'response.done':
        this.emit('response.done', event);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.emit('conversation.item.input_audio_transcription.completed', event);
        break;
      case 'error':
        this.emit('error', event.error);
        break;
      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }
  }

  on(event, handler) {
    if (!event) {
      logger.error('Attempted to register a handler with an undefined event.');
      return;
    }
    logger.info(`Registering handler for event: ${event}`);
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  emit(event, data) {
    if (!event) {
      logger.error('Attempted to emit an undefined event.');
      return;
    }
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach((handler) => handler(data));
    } else {
      logger.warn(`No handlers registered for event: ${event}`);
    }
  }

  sendAudioChunk(rawPCMBase64) {
    try {
      // Send the audio chunk to OpenAI
      const audioPayload = {
        type: 'input_audio_buffer.append',
        audio: rawPCMBase64,
      };
      this.ws.send(JSON.stringify(audioPayload));
      logger.info('Sent input_audio_buffer.append message.');
    } catch (error) {
      logger.error(`Error sending audio chunk: ${error.message}`);
      this.emit('error', { message: 'Error sending audio chunk to OpenAI.' });
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}
