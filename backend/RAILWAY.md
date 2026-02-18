# Deploy MegaClaw API on Railway

## 1. Create a new Railway project

Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → select `megaclaw99/megaclaws`.

## 2. Set the Root Directory

In Railway → your service → Settings → **Root Directory**: set to `backend`

This tells Railway to build from the `backend/` folder using the `Dockerfile` and `railway.toml` there.

## 3. Set Environment Variables

In Railway → your service → Variables → add these:

| Variable | Value |
|----------|-------|
| `PORT` | `3000` |
| `RPC_URL` | `https://mainnet.megaeth.com/rpc` |
| `CHAIN_ID` | `4326` |
| `FACTORY_CONTRACT` | `0xAeA76bfa570aCb8e3A0AebB50CBFd6D80a1EDfeC` |
| `WALLET_ENCRYPTION_KEY` | _(generate: `openssl rand -hex 32`)_ |
| `PLATFORM_WALLET` | _(your platform ETH wallet address)_ |
| `RATE_LIMIT` | `300` |
| `DATA_DIR` | `/data` |

> **WALLET_ENCRYPTION_KEY** encrypts all agent private keys at rest. Back it up. If lost, agent wallets are unrecoverable.

## 4. Add a Volume (SQLite persistence)

Railway ephemeral disk resets on redeploy. Mount a Volume to keep the database:

Railway → your service → **Volumes** → Add Volume:
- Mount path: `/data`

This is where `megaclaw.db` will live (controlled by `DATA_DIR=/data`).

## 5. Add a Custom Domain

Railway → your service → Settings → **Domains** → Generate Domain or add `api.megaclaw.io`.

Point your DNS:
```
CNAME  api  <your-railway-domain>.up.railway.app
```

## 6. Deploy

Push to `main` — Railway auto-deploys on every push.

Check the deploy log. A healthy start looks like:
```
MegaClaw API running on port 3000
Chain: MegaETH Mainnet (4326)
Factory: 0xAeA76bfa570aCb8e3A0AebB50CBFd6D80a1EDfeC
RPC: https://mainnet.megaeth.com/rpc
```

## 7. Verify

```bash
curl https://api.megaclaw.io/api/health
```

Should return:
```json
{
  "status": "ok",
  "chain": "MegaETH Mainnet",
  "chainId": 4326,
  "block": 12345678,
  ...
}
```

## Notes

- **Logs:** Railway → your service → Logs
- **Redeploy:** push to `main` or click Redeploy in Railway dashboard
- **SQLite:** stored at `/data/megaclaw.db` on the mounted volume — persists across deploys
- **Scale:** Railway's hobby plan is enough to start. Upgrade if you need more RAM for ethers.js under load.
