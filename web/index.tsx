import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

// --- Types ---
type TranscriptItem = {
  id: string;
  source: 'user' | 'ai';
  text: string;
  isComplete: boolean;
};

// --- Audio Utilities ---
function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Simple PCM conversion
    let s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return new Blob([int16], { type: 'audio/pcm' });
}

function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const AudioVisualizer = ({ isActive, source }: { isActive: boolean, source: 'user' | 'ai' | 'idle' }) => {
  return (
    <div className="relative flex items-center justify-center h-64 w-64">
       <div className={`orb absolute inset-0 rounded-full border-4 border-indigo-500/30 bg-gray-900 flex items-center justify-center
         ${isActive && source === 'user' ? 'active-user' : ''}
         ${isActive && source === 'ai' ? 'active-ai pulsating' : ''}
       `}>
          <i className={`fas fa-microphone text-5xl transition-colors duration-300
            ${source === 'user' ? 'text-green-400' : source === 'ai' ? 'text-purple-400' : 'text-slate-600'}
          `}></i>
       </div>
    </div>
  );
};

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isError, setIsError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [activeSource, setActiveSource] = useState<'user' | 'ai' | 'idle'>('idle');
  
  // Refs for audio handling to avoid re-renders closing contexts
  const sessionRef = useRef<Promise<any> | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of transcript
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const disconnect = useCallback(async () => {
    if (sessionRef.current) {
      try {
        const session = await sessionRef.current;
        session.close();
      } catch (e) {
        console.error("Error closing session", e);
      }
    }
    
    // Stop all audio sources
    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();

    // Close contexts
    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (outputContextRef.current) {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    setIsConnected(false);
    setActiveSource('idle');
  }, []);

  const connect = useCallback(async () => {
    try {
      setIsError(null);
      
      // Check if running in secure context (HTTPS or localhost)
      if (!window.isSecureContext) {
        setIsError("Microphone access requires HTTPS. Please use a secure connection or access via localhost.");
        return;
      }
      
      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setIsError("Your browser doesn't support microphone access. Please use a modern browser like Chrome, Safari, or Edge.");
        return;
      }
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Initialize Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      inputContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;
      nextStartTimeRef.current = 0;

      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);

      // Get Microphone Stream with explicit constraints
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      streamRef.current = stream;

      // Start Session
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }, // Friendly voice
          },
          systemInstruction: `
            You are an expert English Language Tutor. 
            Your goal is to help the user practice their spoken English in a real-time conversation.
            
            1. Engage the user in a natural, friendly conversation about daily life, hobbies, or any topic they choose.
            2. LISTEN CAREFULLY to their grammar, pronunciation, and vocabulary.
            3. CRITICAL: If the user makes a mistake (grammar, unnatural phrasing), briefly correct them in a supportive way, then continue the conversation. 
               Example: "That's interesting! By the way, usually we say 'I went to the store' instead of 'I go to the store' for the past tense. So, what did you buy there?"
            4. If their English is good, simply converse naturally.
            5. Keep your responses relatively concise to allow for a back-and-forth dialogue.
          `,
          inputAudioTranscription: {}, // Enable user transcription
          outputAudioTranscription: {}, // Enable model transcription
        },
        callbacks: {
          onopen: () => {
            console.log("Connection opened");
            setIsConnected(true);
            
            // Setup Audio Input Processing
            const source = inputCtx.createMediaStreamSource(stream);
            // ScriptProcessor is deprecated but standard for raw PCM access in this API context for now
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Simple volume detection for visualizer
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              if (rms > 0.02) setActiveSource('user');
              else if (activeSource === 'user') setActiveSource('idle');

              // Create blob and send
              // Convert Float32 -1 to 1 to Int16 Little Endian PCM
              const l = inputData.length;
              const buffer = new ArrayBuffer(l * 2);
              const view = new DataView(buffer);
              for (let i = 0; i < l; i++) {
                let s = Math.max(-1, Math.min(1, inputData[i]));
                // Convert to 16-bit PCM
                view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); 
              }
              
              // Base64 encode the buffer manually
              let binary = '';
              const bytes = new Uint8Array(buffer);
              const len = bytes.byteLength;
              for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64Data = btoa(binary);

              // Send audio data to the session
              sessionPromise.then((session) => {
                try {
                  session.sendRealtimeInput({
                    media: {
                      mimeType: 'audio/pcm;rate=16000',
                      data: base64Data
                    }
                  });
                } catch (sendErr) {
                  console.error('Error sending audio data:', sendErr);
                }
              }).catch((sessionErr) => {
                console.error('Session not available:', sessionErr);
              });
            };
            
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle Transcription
            if (msg.serverContent?.outputTranscription) {
               const text = msg.serverContent.outputTranscription.text;
               setTranscripts(prev => {
                 const last = prev[prev.length - 1];
                 if (last && last.source === 'ai' && !last.isComplete) {
                   return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                 }
                 return [...prev, { id: Date.now().toString(), source: 'ai', text: text, isComplete: false }];
               });
               setActiveSource('ai');
            }
            if (msg.serverContent?.inputTranscription) {
               const text = msg.serverContent.inputTranscription.text;
               setTranscripts(prev => {
                 const last = prev[prev.length - 1];
                 if (last && last.source === 'user' && !last.isComplete) {
                   return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                 }
                 return [...prev, { id: Date.now().toString(), source: 'user', text: text, isComplete: false }];
               });
            }
            if (msg.serverContent?.turnComplete) {
              setTranscripts(prev => prev.map(t => ({ ...t, isComplete: true })));
              if (activeSource === 'ai') setActiveSource('idle');
            }

            // Handle Audio Output
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              setActiveSource('ai');
              try {
                // Ensure output context time is synced
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                
                const audioBuffer = await decodeAudioData(
                  decode(base64Audio),
                  outputCtx,
                  24000,
                  1
                );
                
                const source = outputCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputNode);
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                
                source.onended = () => {
                  audioSourcesRef.current.delete(source);
                  if (audioSourcesRef.current.size === 0) {
                     // small delay to let UI settle
                     setTimeout(() => setActiveSource(s => s === 'ai' ? 'idle' : s), 200);
                  }
                };
                audioSourcesRef.current.add(source);

              } catch (err) {
                console.error("Error decoding audio", err);
              }
            }
            
            // Handle interruption
             if (msg.serverContent?.interrupted) {
                audioSourcesRef.current.forEach(s => s.stop());
                audioSourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                setActiveSource('idle');
             }
          },
          onclose: () => {
            console.log("Connection closed");
            setIsConnected(false);
            setActiveSource('idle');
          },
          onerror: (err) => {
            console.error("Connection error", err);
            setIsError("Connection error. Please try again.");
            disconnect();
          }
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (err) {
      console.error(err);
      let errorMessage = "Failed to initialize. Check permissions.";
      
      if (err instanceof DOMException) {
        if (err.name === 'NotFoundError') {
          errorMessage = "No microphone found. Please ensure your device has a microphone connected.";
        } else if (err.name === 'NotAllowedError') {
          errorMessage = "Microphone permission denied. On mobile: go to Settings > Apps > Browser > Permissions and enable Microphone.";
        } else if (err.name === 'NotReadableError') {
          errorMessage = "Microphone is in use by another application. Please close other apps using the microphone.";
        } else if (err.name === 'SecurityError') {
          errorMessage = "Microphone access blocked. Please use HTTPS or access via localhost.";
        }
      } else if (err instanceof Error) {
        if (err.message.includes('API key')) {
          errorMessage = "Invalid API key. Please check your Gemini API key configuration.";
        }
      }
      
      setIsError(errorMessage);
    }
  }, [activeSource, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-between p-6 relative overflow-hidden bg-slate-900">
      
      {/* Background Ambience */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-900/20 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-900/20 rounded-full blur-[100px]"></div>
      </div>

      {/* Header */}
      <header className="z-10 w-full max-w-2xl flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-lg">
            <i className="fas fa-language text-xl"></i>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">FluentAI</h1>
            <p className="text-xs text-indigo-300 uppercase tracking-wider font-semibold">Tutor Mode</p>
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2 border ${isConnected ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-slate-700/50 border-slate-600 text-slate-400'}`}>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`}></div>
          {isConnected ? 'Live Session' : 'Offline'}
        </div>
      </header>

      {/* Main Visualizer Area */}
      <main className="flex-1 flex flex-col items-center justify-center z-10 w-full mb-8 relative">
        {isError && (
          <div className="absolute top-0 bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-2 rounded-lg text-sm mb-4">
            {isError}
          </div>
        )}
        
        <div className="relative">
          <AudioVisualizer isActive={isConnected} source={activeSource} />
          
          {!isConnected && (
            <div className="absolute top-full mt-8 text-slate-400 text-center text-sm max-w-xs mx-auto">
              Ready to practice? I'll listen to your English and help you improve.
            </div>
          )}
          
          {isConnected && activeSource === 'idle' && (
             <div className="absolute top-full mt-8 text-indigo-300/70 text-center text-sm animate-pulse">
               Listening...
             </div>
          )}
        </div>
      </main>

      {/* Transcript Panel */}
      <div className="w-full max-w-2xl h-64 glass-panel rounded-2xl flex flex-col overflow-hidden z-10 shadow-2xl mb-6">
        <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex justify-between items-center">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Live Transcript</span>
          <button 
            onClick={() => setTranscripts([])}
            className="text-xs text-slate-500 hover:text-white transition-colors"
          >
            Clear
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
          {transcripts.length === 0 ? (
             <div className="h-full flex items-center justify-center text-slate-600 text-sm italic">
               Conversation history will appear here...
             </div>
          ) : (
            transcripts.map((t, i) => (
              <div key={i} className={`flex ${t.source === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  t.source === 'user' 
                    ? 'bg-indigo-600/80 text-white rounded-br-sm' 
                    : 'bg-slate-700/80 text-slate-200 rounded-bl-sm'
                }`}>
                  <div className="text-[10px] opacity-50 mb-1 font-bold uppercase">
                    {t.source === 'user' ? 'You' : 'Tutor'}
                  </div>
                  {t.text}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Controls */}
      <div className="z-10 w-full max-w-xs flex justify-center pb-6">
        {!isConnected ? (
          <button
            onClick={connect}
            className="group relative flex items-center justify-center w-16 h-16 rounded-full bg-white text-indigo-600 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] transition-all transform hover:scale-105"
          >
             <i className="fas fa-microphone text-2xl"></i>
             <div className="absolute -inset-1 rounded-full border border-white/30 animate-ping opacity-20 group-hover:opacity-40"></div>
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-500/20 border border-red-500/50 text-red-200 hover:bg-red-500/30 transition-all"
          >
            <i className="fas fa-stop"></i>
            <span className="font-medium">End Session</span>
          </button>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
