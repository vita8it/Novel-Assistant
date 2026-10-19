# Novel's Assistant

Rules-based Discord assistant that answers supported questions with language-specific Embed replies.

## Requirements

- Node.js 20.6 or later
- A Discord bot token
- A Groq API key

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env` and set `DISCORD_BOT_TOKEN` and `GROQ_API_KEY`.
3. Enable the **Message Content Intent** for the bot in the Discord Developer Portal.
4. Start the bot:

   ```powershell
   npm start
   ```

Run the automated tests with `npm test`.

The bot reads `backend/Rules.md` as its answer source. It responds only in the configured channels in `backend/Chanel.js`, using each channel's configured language, and remains silent when a question is not supported by the rules.
