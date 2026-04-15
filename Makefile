SHELL := /bin/bash

ENV_FILE ?= .env.local
PID_FILE ?= /tmp/soon-api.pid
LOG_FILE ?= /tmp/soon-api.log
BASE_URL ?= http://127.0.0.1:3100
START_WAIT_SEC ?= 30

.PHONY: help migrate up status check doctor smoke down restart logs

help:
	@echo "Soon local ops"
	@echo "  make up      - run db migrations, start API in background, wait for health"
	@echo "  make status  - print health + read-model status"
	@echo "  make check   - run read-model alert checker"
	@echo "  make doctor  - full diagnostics report (health/status/metrics/checker)"
	@echo "  make smoke   - run full quality gate (contracts+workers+smoke)"
	@echo "  make down    - stop background API"
	@echo "  make restart - down + up"
	@echo "  make logs    - tail API log"

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

status:
	@echo "[Soon] health:" \
	&& curl -fsS "$(BASE_URL)/health" \
	&& echo "\n[Soon] read-model status:" \
	&& curl -fsS "$(BASE_URL)/automation/read-model/status" \
	&& echo

check:
	@npm run -s obs:read-model:alert:check

doctor:
	@bash -lc 'set -euo pipefail; \
	echo "[Soon/doctor] health"; \
	HEALTH="$$(curl -fsS "$(BASE_URL)/health")"; \
	echo "$$HEALTH"; \
	echo; \
	echo "[Soon/doctor] read-model status"; \
	STATUS="$$(curl -fsS "$(BASE_URL)/automation/read-model/status")"; \
	echo "$$STATUS"; \
	echo; \
	echo "[Soon/doctor] metrics (core read-model lines)"; \
	METRICS="$$(curl -fsS "$(BASE_URL)/metrics" | rg "soon_read_model_refresh_(info|pending_count|in_flight|total_errors|last_duration_ms)" -n || true)"; \
	if [ -z "$$METRICS" ]; then \
	  echo "[Soon/doctor] FAIL: required metrics not found"; \
	  exit 1; \
	fi; \
	echo "$$METRICS"; \
	echo; \
	echo "[Soon/doctor] alert checker"; \
	npm run -s obs:read-model:alert:check; \
	echo; \
	echo "[Soon/doctor] PASS";'

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
