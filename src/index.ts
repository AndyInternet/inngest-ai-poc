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
  if (connections) {
    const messageStr = JSON.stringify(message);
    connections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }
}

app.use(express.json());
app.use(express.static("dist/examples"));

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
                  try {
                    const message = JSON.parse(event.data);

                    // Skip connection confirmation messages
                    if (message.type === 'connected') {
                      console.log('🎉 WebSocket session established:', message.sessionId);
                      return;
                    }

                    console.log('📨 Received WebSocket message:', message.data || message);

                    const dataEvent = new CustomEvent('data', {
                      detail: message.data || message
                    });
                    eventTarget.dispatchEvent(dataEvent);
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

    if (!sessionId || !answers) {
      return res
        .status(400)
        .json({ error: "sessionId and answers are required" });
    }

    // Send event to continue workflow with answers
    await inngest.send({
      name: "feature.validation.answers.provided",
      data: {
        sessionId,
        answers,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to submit answers:", error);
    res.status(500).json({ error: "Failed to submit answers" });
  }
});

httpServer.listen(PORT, () => {
  console.log("🚀 AI Feature Validation Tool");
  console.log("═".repeat(50));
  console.log(`✅ Server running on port ${PORT}`);
  console.log(
    "✅ WebSocket server ready on ws://localhost:${PORT}/api/realtime/ws",
  );
  console.log("✅ Inngest functions ready");
  console.log("✅ Web interface available");
  console.log("✅ API endpoints configured\n");

  console.log("🌐 Access the tool:");
  console.log(`   http://localhost:${PORT}/feature-validation/\n`);

  console.log("📝 Make sure Inngest dev server is also running:");
  console.log("   npx inngest-cli@latest dev\n");

  console.log("💡 The web interface provides:");
  console.log("   • Feature input form");
  console.log("   • Real-time AI agent streaming via WebSocket");
  console.log("   • Workflow progress tracking");
  console.log("   • Interactive results display\n");

  console.log("⚠️  Keep this terminal running for the service.");
  console.log("   Press Ctrl+C to stop.\n");
});
