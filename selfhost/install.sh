#!/bin/sh
# Sets up Kolbaba in this folder: asks for the domain, makes .env, starts everything, prints the first link.
set -eu
cd "$(dirname "$0")"

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker isn't installed. On a Linux server: curl -fsSL https://get.docker.com | sh" >&2
  exit 1
fi

if [ ! -f .env ]; then
  printf "Your domain, pointing at this server (e.g. mail.example.com): "
  read -r domain
  [ -n "$domain" ] || { echo "A domain is needed." >&2; exit 1; }
  sed -e "s|^DOMAIN=.*|DOMAIN=$domain|" -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env.example > .env
  chmod 600 .env
fi

# The image is public, so no login is needed. Watchtower still mounts Docker's login file for registries
# that need one: if it's missing, Docker would create a folder in its place, so start with an empty file.
docker_config="${DOCKER_CONFIG_FILE:-$(sed -n 's/^DOCKER_CONFIG_FILE=//p' .env | tail -n 1)}"
docker_config="${docker_config:-$HOME/.docker/config.json}"
if [ ! -e "$docker_config" ]; then
  mkdir -p "$(dirname "$docker_config")"
  echo '{}' > "$docker_config"
  chmod 600 "$docker_config"
fi

mkdir -p backups
docker compose pull || { echo "Couldn't download Kolbaba. Check this server's internet connection, then start this again." >&2; exit 1; }
docker compose up -d

printf "Starting"
i=0
until docker compose exec -T kolbaba node -e "fetch('http://127.0.0.1:3000/api/version').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || { echo; echo "Kolbaba didn't start. See: docker compose logs kolbaba" >&2; exit 1; }
  printf "."
  sleep 2
done
echo
docker compose exec -T kolbaba kolbaba-link
