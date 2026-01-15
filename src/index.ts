import * as dotenv from "dotenv";
import express from "express";
import { serve } from "inngest/express";
import { inngest } from "./inngest/client";
import { functions } from "./inngest/functions";
import { getSubscriptionToken } from "@inngest/realtime";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

// Load environment variables
dotenv.config();

// Import streaming messages from agent
import { streamingMessages } from "./ai/agent";

const app = express();
const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);

// WebSocket server for real-time streaming
const wss = new WebSocketServer({
  server: httpServer,
  path: "/api/realtime/ws",
});

// Store WebSocket connections by session ID
const wsConnections = new Map<string, Set<WebSocket>>();

// WebSocket connection handler
wss.on("connection", (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    ws.close(1008, "sessionId required");
    return;
  }

  console.log(`🔌 WebSocket connected for session: ${sessionId}`);

  // Add connection to session set
  if (!wsConnections.has(sessionId)) {
    wsConnections.set(sessionId, new Set());
  }
  wsConnections.get(sessionId)!.add(ws);

  // Send connection confirmation
  ws.send(JSON.stringify({ type: "connected", sessionId }));

  // Send any existing messages for this session
  const existingMessages = streamingMessages.get(sessionId) || [];
  existingMessages.forEach((message) => {
    ws.send(JSON.stringify(message));
  });

  ws.on("close", () => {
    console.log(`🔌 WebSocket disconnected for session: ${sessionId}`);
    const connections = wsConnections.get(sessionId);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        wsConnections.delete(sessionId);
      }
    }
  });

  ws.on("error", (error) => {
    console.error(`WebSocket error for session ${sessionId}:`, error);
  });
});

// Helper function to broadcast message to all WebSocket clients for a session
export function broadcastToSession(sessionId: string, message: any) {
  const connections = wsConnections.get(sessionId);
  if (!connections || connections.size === 0) {
    console.log(`[broadcastToSession] No WebSocket connections found for session: ${sessionId}`);
    console.log(`[broadcastToSession] Available sessions: ${Array.from(wsConnections.keys()).join(', ') || 'none'}`);
    return;
  }

  const messageStr = JSON.stringify(message);
  let sentCount = 0;
  connections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      console.log(`[broadcastToSession] Sending ${messageStr.length} bytes to WebSocket...`);
      ws.send(messageStr);
      sentCount++;
      console.log(`[broadcastToSession] ws.send() completed`);
    } else {
      console.log(`[broadcastToSession] WebSocket not open, state: ${ws.readyState}`);
    }
  });
  console.log(`[broadcastToSession] Sent to ${sentCount}/${connections.size} clients for session: ${sessionId}`);
}

app.use(express.json());
app.use(express.static("dist/examples"));

// Landing page with links to examples
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AI Agent Pipeline Examples</title>
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          margin: 0;
          padding: 40px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
        }
        h1 {
          color: white;
          text-align: center;
          margin-bottom: 10px;
        }
        .subtitle {
          color: rgba(255,255,255,0.9);
          text-align: center;
          margin-bottom: 40px;
        }
        .card {
          background: white;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 20px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          text-decoration: none;
          display: block;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 30px rgba(0,0,0,0.2);
        }
        .card h2 {
          margin: 0 0 8px 0;
          color: #333;
        }
        .card p {
          margin: 0;
          color: #666;
          line-height: 1.5;
        }
        .tag {
          display: inline-block;
          background: #e9ecef;
          color: #495057;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          margin-top: 12px;
        }
        .footer {
          text-align: center;
          color: rgba(255,255,255,0.8);
          margin-top: 40px;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>AI Agent Pipeline Examples</h1>
        <p class="subtitle">Demonstrating Inngest-powered AI agent workflows</p>

        <a href="/feature-validation/" class="card">
          <h2>Feature Validation</h2>
          <p>Validate feature ideas with AI-powered analysis. Demonstrates sequential agent pipelines, human-in-the-loop questioning, and comprehensive report generation.</p>
          <span class="tag">Sequential Pipeline</span>
        </a>

        <a href="/games-with-branching/" class="card">
          <h2>Games with Branching</h2>
          <p>Play Trivia or 20 Questions! Demonstrates pipeline branching where user choice determines which game agent runs.</p>
          <span class="tag">Pipeline Branching</span>
        </a>

        <p class="footer">
          Make sure the Inngest dev server is running: <code>npx inngest-cli@latest dev</code>
        </p>
      </div>
    </body>
    </html>
  `);
});

app.use(
  "/api/inngest",
  serve({
    client: inngest,
    functions: functions,
  }),
);

// Endpoint to generate subscription tokens for realtime streaming
app.post("/api/subscribe-token", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const channel = `feature-validation:${sessionId}`;
    const topics = ["agent_updates"];

    const token = await getSubscriptionToken(inngest, {
      channel,
      topics,
    });

    // Return both the token string and structured info for the client
    res.json({
      token: token,
      channel: `feature-validation:${sessionId}`,
      topics: ["agent_updates"],
    });
  } catch (error) {
    console.error("Failed to generate subscription token:", error);
    res.status(500).json({ error: "Failed to generate subscription token" });
  }
});

// Endpoint to get streaming messages for a session
app.get("/api/stream/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  const since = parseInt(req.query.since as string) || 0;

  const messages = streamingMessages.get(sessionId) || [];
  const newMessages = messages.filter((msg) => msg.timestamp > since);

  res.json({ messages: newMessages });
});

// SSE endpoint for real-time streaming via server proxy
app.get("/api/realtime/stream", async (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    return res.status(400).send("Token required");
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    // Parse the token to get channel info
    const tokenData = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString(),
    );
    const channel = tokenData.topics?.[0]?.channel;

    if (!channel) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: "Invalid token" })}\n\n`,
      );
      res.end();
      return;
    }

    // Extract session ID from channel
    const sessionId = channel.split(":")[1];

    console.log(`📡 SSE client connected for session: ${sessionId}`);

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`);

    let lastTimestamp = 0;

    // Poll the message store and send updates via SSE
    const pollInterval = setInterval(() => {
      const messages = streamingMessages.get(sessionId) || [];
      const newMessages = messages.filter(
        (msg) => msg.timestamp > lastTimestamp,
      );

      newMessages.forEach((message) => {
        res.write(`data: ${JSON.stringify(message)}\n\n`);
        lastTimestamp = Math.max(lastTimestamp, message.timestamp);
      });
    }, 500);

    // Clean up on disconnect
    req.on("close", () => {
      console.log(`🔌 SSE client disconnected for session: ${sessionId}`);
      clearInterval(pollInterval);
    });
  } catch (error) {
    console.error("Error in SSE endpoint:", error);
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: "Internal error" })}\n\n`,
    );
    res.end();
  }
});

// Endpoint to serve realtime library script with WebSocket support
app.get("/api/realtime.js", async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(`
      // Inngest Realtime Client using WebSocket
      (function() {
        window.InngestRealtime = {
          subscribe: function(options) {
            const tokenData = options.token;
            const channel = typeof tokenData === 'string' ? 'unknown' : tokenData.channel;
            const sessionId = channel ? channel.split(':')[1] : 'unknown';

            console.log('📡 Connecting to WebSocket Stream...', { channel, sessionId });

            const eventTarget = new EventTarget();
            let ws = null;
            let isConnected = false;
            let reconnectTimeout = null;
            let shouldReconnect = true;
            let reconnectAttempts = 0;
            const maxReconnectAttempts = 10;

            function connect() {
              const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
              const wsUrl = protocol + '//' + window.location.host + '/api/realtime/ws?sessionId=' + encodeURIComponent(sessionId);

              console.log('🔌 Establishing WebSocket connection to:', wsUrl);

              try {
                ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                  console.log('✅ WebSocket connected');
                  isConnected = true;
                  reconnectAttempts = 0;
                  const connectEvent = new Event('connect');
                  eventTarget.dispatchEvent(connectEvent);
                };

                ws.onmessage = (event) => {
                  console.log('🔔 RAW WebSocket message received, length:', event.data?.length);
                  try {
                    const message = JSON.parse(event.data);
                    console.log('🔔 Parsed message type:', message.type);

                    // Skip connection confirmation messages
                    if (message.type === 'connected') {
                      console.log('🎉 WebSocket session established:', message.sessionId);
                      return;
                    }

                    console.log('📨 Received WebSocket message:', message.type, message.content?.substring(0, 50) || '(no content)');

                    // Pass the entire message - don't extract .data as that's metadata, not the message itself
                    const dataEvent = new CustomEvent('data', {
                      detail: message
                    });
                    console.log('🔔 Dispatching data event with detail:', message.type);
                    eventTarget.dispatchEvent(dataEvent);
                    console.log('🔔 Data event dispatched');
                  } catch (error) {
                    console.error('Failed to parse WebSocket message:', error, event.data);
                  }
                };

                ws.onerror = (error) => {
                  console.error('❌ WebSocket error:', error);
                  const errorEvent = new CustomEvent('error', {
                    detail: { message: 'WebSocket error', error }
                  });
                  eventTarget.dispatchEvent(errorEvent);
                };

                ws.onclose = (event) => {
                  console.log('🔌 WebSocket closed:', event.code, event.reason);
                  isConnected = false;
                  ws = null;

                  const disconnectEvent = new Event('disconnect');
                  eventTarget.dispatchEvent(disconnectEvent);

                  // Attempt to reconnect
                  if (shouldReconnect && reconnectAttempts < maxReconnectAttempts) {
                    reconnectAttempts++;
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000);
                    console.log(\`🔄 Will attempt to reconnect in \${delay}ms (attempt \${reconnectAttempts}/\${maxReconnectAttempts})...\`);

                    reconnectTimeout = setTimeout(() => {
                      reconnectTimeout = null;
                      if (shouldReconnect) {
                        console.log('🔄 Reconnecting...');
                        connect();
                      }
                    }, delay);
                  } else if (reconnectAttempts >= maxReconnectAttempts) {
                    console.error('❌ Max reconnection attempts reached');
                    const errorEvent = new CustomEvent('error', {
                      detail: { message: 'Max reconnection attempts reached' }
                    });
                    eventTarget.dispatchEvent(errorEvent);
                  }
                };
              } catch (error) {
                console.error('❌ Failed to create WebSocket:', error);
                const errorEvent = new CustomEvent('error', {
                  detail: { message: 'Failed to create WebSocket', error }
                });
                eventTarget.dispatchEvent(errorEvent);
              }
            }

            // Start connection
            connect();

            return {
              on: (event, callback) => {
                eventTarget.addEventListener(event, (e) => {
                  if (event === 'data' || event === 'error') {
                    callback(e.detail);
                  } else {
                    callback(e);
                  }
                });
              },
              close: () => {
                console.log('🔌 Closing WebSocket connection');
                shouldReconnect = false;
                if (reconnectTimeout) {
                  clearTimeout(reconnectTimeout);
                  reconnectTimeout = null;
                }
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.close(1000, 'Client requested close');
                }
                ws = null;
                isConnected = false;
              }
            };
          }
        };

        console.log('✅ InngestRealtime WebSocket client loaded');
      })();
    `);
  } catch (error) {
    console.error("Failed to load realtime client:", error);
    res.status(500).send("// Failed to load realtime client");
  }
});

// Endpoint to trigger the feature validation workflow
app.post("/api/trigger-workflow", async (req, res) => {
  try {
    const { featureDescription, existingContext = "", sessionId } = req.body;

    if (!featureDescription) {
      return res.status(400).json({ error: "featureDescription is required" });
    }

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const eventId = await inngest.send({
      name: "feature.validation.start",
      data: {
        featureDescription,
        existingContext,
        sessionId,
      },
    });

    res.json({
      success: true,
      eventId: eventId.ids[0],
      sessionId,
    });
  } catch (error) {
    console.error("Failed to trigger workflow:", error);
    res.status(500).json({ error: "Failed to trigger workflow" });
  }
});

// Endpoint to submit answers for human-in-the-loop
app.post("/api/submit-answers", async (req, res) => {
  try {
    const { sessionId, answers } = req.body;

    console.log(`[submit-answers] Received: sessionId=${sessionId}, answers=`, answers);

    if (!sessionId || !answers) {
      return res
        .status(400)
        .json({ error: "sessionId and answers are required" });
    }

    // Send events for both workflows - they will pick up based on sessionId
    console.log(`[submit-answers] Sending games.user.response event for session ${sessionId}`);
    await Promise.all([
      inngest.send({
        name: "feature.validation.answers.provided",
        data: {
          sessionId,
          answers,
        },
      }),
      inngest.send({
        name: "games.user.response",
        data: {
          sessionId,
          answers,
        },
      }),
    ]);

    console.log(`[submit-answers] Events sent successfully`);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to submit answers:", error);
    res.status(500).json({ error: "Failed to submit answers" });
  }
});

// Endpoint to trigger the games workflow
app.post("/api/trigger-game", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const eventId = await inngest.send({
      name: "games.start",
      data: {
        sessionId,
      },
    });

    res.json({
      success: true,
      eventId: eventId.ids[0],
      sessionId,
    });
  } catch (error) {
    console.error("Failed to trigger game:", error);
    res.status(500).json({ error: "Failed to trigger game" });
  }
});

httpServer.listen(PORT, () => {
  console.log("🚀 AI Agent Pipeline Examples");
  console.log("═".repeat(50));
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ WebSocket server ready`);
  console.log("✅ Inngest functions ready");
  console.log("✅ API endpoints configured\n");

  console.log(`🌐 Open in browser: http://localhost:${PORT}\n`);

  console.log("📝 Make sure Inngest dev server is also running:");
  console.log("   npx inngest-cli@latest dev\n");
});
