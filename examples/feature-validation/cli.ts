#!/usr/bin/env node

import * as dotenv from "dotenv";

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

if (!ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY environment variable is required.");
  console.error("Please add it to your .env file.");
  process.exit(1);
}

function main() {
  console.log("🚀 AI Feature Validation Tool");
  console.log("═".repeat(50));
  console.log("✅ Environment variables validated\n");

  console.log("📝 To run the complete service:");
  console.log("1. Start Inngest dev server (in one terminal):");
  console.log("   npx inngest-cli@latest dev");
  console.log("2. Start the web service (in another terminal):");
  console.log("   npm run dev\n");

  console.log("🌐 Then access the web interface:");
  console.log("   http://localhost:3000/feature-validation/\n");

  console.log("💡 The web interface includes:");
  console.log("   • Feature input form");
  console.log("   • Real-time AI agent streaming");
  console.log("   • Workflow progress tracking");
  console.log("   • Interactive results display\n");

  console.log("🎯 Just 2 commands needed - that's it!");
}

main();
