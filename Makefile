SHELL := /bin/bash

ENV_FILE ?= .env.local
PID_FILE ?= /tmp/soon-api.pid
LOG_FILE ?= /tmp/soon-api.log
BASE_URL ?= http://127.0.0.1:3100
START_WAIT_SEC ?= 30

.PHONY: help migrate up up-lan mobile-url docker-up docker-down docker-logs docker-mobile-url status check doctor doctor-json smoke down restart logs wf-start wf-finish

help:
	@echo "Soon local ops"
	@echo "  make up      - run db migrations, start API in background, wait for health"
	@echo "  make up-lan  - start API bound to 0.0.0.0 for smartphone/LAN testing"
	@echo "  make mobile-url CHAT_ID=<id> - print LAN test URLs for smartphone"
	@echo "  make docker-up - build and start app+postgres in Docker Desktop"
	@echo "  make docker-down - stop Docker Desktop stack"
	@echo "  make docker-logs - tail app logs from Docker Desktop stack"
	@echo "  make docker-mobile-url CHAT_ID=<id> - print smartphone URL for Docker Desktop run"
	@echo "  make status  - print health + read-model status"
	@echo "  make check   - run read-model alert checker"
	@echo "  make doctor  - diagnostics + self-heal dead-letter requeue triage (artifacts in ops/reports/doctor)"
	@echo "  make doctor-json - print full doctor report JSON"
	@echo "  make smoke   - run full quality gate (contracts+workers+smoke)"
	@echo "  make down    - stop background API"
	@echo "  make restart - down + up"
	@echo "  make logs    - tail API log"
	@echo "  make wf-start BRANCH=feat/<name> - sync main and create a task branch"
	@echo "  make wf-finish - run checks and print push/PR next steps"

migrate:
	@npm run -s db:migrate

up: migrate
	@if [ -f "$(PID_FILE)" ] && kill -0 "$$(cat "$(PID_FILE)")" 2>/dev/null; then \
	  echo "[Soon] API already running (pid=$$(cat "$(PID_FILE)"))"; \
	  exit 0; \
	fi
	@echo "[Soon] starting API in background..."
	@nohup npm run -s dev:api >"$(LOG_FILE)" 2>&1 & echo $$! > "$(PID_FILE)"
	@for i in $$(seq 1 "$(START_WAIT_SEC)"); do \
	  if curl -fsS "$(BASE_URL)/health" >/dev/null 2>&1; then \
	    echo "[Soon] API UP at $(BASE_URL) (pid=$$(cat "$(PID_FILE)"))"; \
	    exit 0; \
	  fi; \
	  sleep 1; \
	done; \
	echo "[Soon] API failed to become healthy. See $(LOG_FILE)"; \
	exit 1

up-lan: migrate
	@if [ -f "$(PID_FILE)" ] && kill -0 "$$(cat "$(PID_FILE)")" 2>/dev/null; then \
	  echo "[Soon] API already running (pid=$$(cat "$(PID_FILE)"))"; \
	  exit 0; \
	fi
	@echo "[Soon] starting API for LAN (HOST=0.0.0.0)..."
	@nohup env HOST=0.0.0.0 npm run -s dev:api >"$(LOG_FILE)" 2>&1 & echo $$! > "$(PID_FILE)"
	@for i in $$(seq 1 "$(START_WAIT_SEC)"); do \
	  if curl -fsS "http://127.0.0.1:3100/health" >/dev/null 2>&1; then \
	    echo "[Soon] API UP (LAN) on 0.0.0.0:3100 (pid=$$(cat "$(PID_FILE)"))"; \
	    exit 0; \
	  fi; \
	  sleep 1; \
	done; \
	echo "[Soon] API failed to become healthy. See $(LOG_FILE)"; \
	exit 1

mobile-url:
	@CHAT="$${CHAT_ID:-demo}"; \
	IPS="$$(hostname -I 2>/dev/null || true)"; \
	if [ -z "$$IPS" ]; then \
	  IPS="$$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($$i=="src") {print $$(i+1); exit}}')"; \
	fi; \
	if [ -z "$$IPS" ]; then \
	  echo "[Soon/mobile] hostname -I unavailable. Use machine LAN IP manually."; \
	  echo "http://<LAN-IP>:3100/?chatId=$$CHAT"; \
	  exit 0; \
	fi; \
	for ip in $$IPS; do \
	  case "$$ip" in \
	    127.*) ;; \
	    *) echo "http://$$ip:3100/?chatId=$$CHAT" ;; \
	  esac; \
	done

docker-up:
	@docker compose up -d --build
	@echo "[Soon/docker] waiting for app health..."
	@for i in $$(seq 1 60); do \
	  if curl -fsS "http://127.0.0.1:3100/health" >/dev/null 2>&1; then \
	    echo "[Soon/docker] API UP at http://127.0.0.1:3100"; \
	    exit 0; \
	  fi; \
	  sleep 1; \
	done; \
	echo "[Soon/docker] API failed to become healthy in 60s"; \
	exit 1

docker-down:
	@docker compose down

docker-logs:
	@docker compose logs -f app

docker-mobile-url:
	@CHAT="$${CHAT_ID:-demo}"; \
	IPS="$$(hostname -I 2>/dev/null || true)"; \
	if [ -z "$$IPS" ]; then \
	  IPS="$$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($$i=="src") {print $$(i+1); exit}}')"; \
	fi; \
	if [ -z "$$IPS" ]; then \
	  echo "http://<LAN-IP>:3100/?chatId=$$CHAT"; \
	  exit 0; \
	fi; \
	for ip in $$IPS; do \
	  case "$$ip" in \
	    127.*) ;; \
	    *) echo "http://$$ip:3100/?chatId=$$CHAT" ;; \
	  esac; \
	done

status:
	@echo "[Soon] health:" \
	&& curl -fsS "$(BASE_URL)/health" \
	&& echo "\n[Soon] read-model status:" \
	&& curl -fsS "$(BASE_URL)/automation/read-model/status" \
	&& echo

check:
	@npm run -s obs:read-model:alert:check
	@npm run -s obs:runtime:alert:check

doctor:
	@npm run -s obs:doctor:report
	@SOON_SELF_HEAL_TRIAGE_OUT=ops/reports/doctor/self-heal-triage.json npm run -s ops:self-heal:requeue:triage

doctor-json:
	@npm run -s obs:doctor:report:json

smoke:
	@npm run -s check

logs:
	@touch "$(LOG_FILE)" && tail -n 80 "$(LOG_FILE)"

down:
	@if [ ! -f "$(PID_FILE)" ]; then \
	  echo "[Soon] API not running (no pid file)"; \
	  exit 0; \
	fi
	@PID="$$(cat "$(PID_FILE)")"; \
	if kill -0 "$$PID" 2>/dev/null; then \
	  kill "$$PID" && echo "[Soon] API stopped (pid=$$PID)"; \
	else \
	  echo "[Soon] stale pid file (pid=$$PID not running)"; \
	fi; \
	rm -f "$(PID_FILE)"

restart: down up

wf-start:
	@if [ -z "$(BRANCH)" ]; then \
	  echo "[Soon/workflow] missing BRANCH, e.g. make wf-start BRANCH=feat/ui-settings-v1"; \
	  exit 1; \
	fi
	@echo "[Soon/workflow] syncing main..."
	@git checkout main
	@git pull --ff-only
	@echo "[Soon/workflow] creating branch $(BRANCH)..."
	@git checkout -b "$(BRANCH)"
	@echo "[Soon/workflow] ready on branch: $$(git branch --show-current)"

wf-finish:
	@echo "[Soon/workflow] running checks..."
	@$(MAKE) check
	@echo "[Soon/workflow] done."
	@echo "Next:"
	@echo "  git add -A"
	@echo "  git commit -m \"<type>: <scope>\""
	@echo "  git push -u origin $$(git branch --show-current)"
	@echo "  gh pr create --base main --head $$(git branch --show-current)"
