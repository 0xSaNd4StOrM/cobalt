# Freebind Setup Commands

## Step 1 — Enable freebind on VPS (run once via SSH)

```bash
sudo sysctl -w net.ipv6.ip_nonlocal_bind=1
```

```bash
echo "net.ipv6.ip_nonlocal_bind = 1" | sudo tee -a /etc/sysctl.conf
```

---

## Step 2 — Add env variable in Dokploy

In Dokploy → cobalt service → **Environment** tab, add:

```
FREEBIND_CIDR=2a02:c207:2273:3763::/64
```

---

## Step 3 — Find the Dokploy compose file

```bash
find /etc/dokploy -name "docker-compose.yml" 2>/dev/null
```

```bash
find /root/dokploy -name "docker-compose.yml" 2>/dev/null
```

```bash
docker ps | grep cobalt
```

---

## Step 4 — Open the compose file (replace PATH with result from step 3)

```bash
nano /etc/dokploy/applications/cobalt/docker-compose.yml
```

Add these lines inside the cobalt service, after `restart: unless-stopped`:

```yaml
        cap_add:
          - NET_ADMIN
          - NET_RAW
```

Save: `Ctrl+O` → `Enter` → `Ctrl+X`

---

## Step 5 — Restart the container (replace PATH with your path)

```bash
docker compose -f /etc/dokploy/applications/cobalt/docker-compose.yml up -d
```

---

## Step 6 — Verify everything works

```bash
docker inspect cobalt --format '{{.HostConfig.CapAdd}}'
```

Expected output: `[NET_ADMIN NET_RAW]`

```bash
curl -6 https://ipv6.icanhazip.com
```

Run the curl command 3 times — each should show a **different IPv6 address**. If they differ, freebind is working.
