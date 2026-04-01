# Slack App Setup Guide

This guide walks you through creating and configuring a Slack app to send messages to Cortex.

## Step 1: Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name it (e.g., "Cortex Bot") and select your workspace
4. Click **Create App**

## Step 2: Configure Bot Token Scopes

1. In the left sidebar, go to **OAuth & Permissions**
2. Scroll to **Bot Token Scopes** and add:
   - `channels:history` - Read messages in public channels
   - `channels:read` - View basic channel info
   - `groups:history` - Read messages in private channels the bot is in
   - `users:read` - Resolve user display names

## Step 3: Install to Workspace

1. Scroll to the top of **OAuth & Permissions**
2. Click **Install to Workspace**
3. Authorize the requested permissions
4. Copy the **Bot User OAuth Token** (`xoxb-...`)
5. Add it to your `.env` file as `SLACK_BOT_TOKEN`

## Step 4: Get the Signing Secret

1. Go to **Basic Information** in the left sidebar
2. Under **App Credentials**, find **Signing Secret**
3. Click **Show** and copy it
4. Add it to your `.env` file as `SLACK_SIGNING_SECRET`

## Step 5: Get the Verification Token

1. On the same **Basic Information** page, under **App Credentials**, find **Verification Token**
2. Copy it
3. Add it to your `.env` file as `SLACK_VERIFICATION_TOKEN`

> **Note:** The Signing Secret (Step 4) is the preferred verification method but
> requires HTTP header access. Harper custom Resources receive only the parsed
> request body, so Cortex uses the Verification Token for body-level authentication.
> The Signing Secret is retained for future use.

## Step 6: Enable Event Subscriptions

1. Go to **Event Subscriptions** in the left sidebar
2. Toggle **Enable Events** to **On**
3. Set the **Request URL** to your Harper endpoint:
   - **Local development**: `https://YOUR_NGROK_URL/SlackWebhook`
   - **Production**: `https://YOUR_CLUSTER.harperfabric.com/SlackWebhook`
4. Slack will send a verification challenge. The app handles this automatically.

## Step 7: Subscribe to Bot Events

Under **Subscribe to bot events**, add:

- `message.channels` - Messages in public channels
- `message.groups` - Messages in private channels (optional)

Click **Save Changes**.

## Step 8: Reinstall if Prompted

If Slack asks you to reinstall the app after changing scopes or events, do so.

## Step 9: Invite the Bot

In each Slack channel you want monitored, type:

```
/invite @Cortex Bot
```

(Use whatever name you gave your app in Step 1.)

## Verification

Send a test message in a monitored channel. Check the Memory table:

```bash
curl https://YOUR_CLUSTER.harperfabric.com/Memory/ \
  -H "Authorization: Basic YOUR_AUTH"
```

You should see a new record with `rawText`, `classification`, `entities`, and `embedding` populated.
