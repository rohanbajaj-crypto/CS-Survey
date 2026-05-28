# Smart Worker Feedback Form

A client-facing feedback form that pulls Smart Worker (placement order) data from HubSpot and collects CSAT ratings.

## How it works

1. Client visits the link (e.g. `yourapp.vercel.app/?company=CAVU`)
2. App searches HubSpot for the company → fetches all placement orders (custom object 0-970)
3. Displays one CSAT rating (1–10) per Smart Worker
4. On submit, feedback is saved as notes on each placement order in HubSpot

## Deploy to Vercel (2 minutes)

### Step 1: Push to GitHub
1. Create a new repo on GitHub (e.g. `smart-worker-feedback`)
2. Push this folder to it:
   ```bash
   cd sw-feedback
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/smart-worker-feedback.git
   git push -u origin main
   ```

### Step 2: Deploy on Vercel
1. Go to [vercel.com](https://vercel.com) → Sign up with GitHub
2. Click "New Project" → Import your `smart-worker-feedback` repo
3. **Add Environment Variable:**
   - Key: `HUBSPOT_TOKEN`
   - Value: Your HubSpot Private App token
4. Click "Deploy"

### Step 3: Done!
Your form is live at `smart-worker-feedback.vercel.app`

## HubSpot Private App Setup

1. Go to HubSpot → Settings → Integrations → Private Apps
2. Click "Create a private app"
3. Name it "Smart Worker Feedback"
4. Under Scopes, enable:
   - `crm.objects.custom.read`
   - `crm.objects.companies.read`
   - `crm.objects.contacts.read`
   - `crm.objects.deals.read`
5. Create → Copy the token → Paste in Vercel env vars

## Sharing with Clients

Send the link with the company pre-filled:
```
https://yourapp.vercel.app/?company=CAVU
```

The client will only see the rating form — no setup, no tokens, no HubSpot internals.

## File Structure
```
sw-feedback/
├── api/
│   └── hubspot.js        # Serverless proxy (hides API token)
├── src/
│   ├── App.jsx            # Main React app
│   ├── index.css          # Styles
│   └── main.jsx           # Entry point
├── index.html
├── package.json
├── vercel.json
└── vite.config.js
```
