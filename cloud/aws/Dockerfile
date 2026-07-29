FROM node:20-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY scripts ./scripts
COPY server ./server
COPY supabase ./supabase
RUN npm run build:vercel-ai-server

FROM public.ecr.aws/lambda/nodejs:20

ARG CLAUDE_CODE_VERSION=2.1.220
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && ln -sf "$(command -v claude)" /usr/local/bin/claude \
    && claude --version

COPY --from=builder /app/server-dist ${LAMBDA_TASK_ROOT}/server-dist
COPY cloud/aws/lambda-handler.mjs ${LAMBDA_TASK_ROOT}/cloud/aws/lambda-handler.mjs

ENV CLAUDE_CLI_PATH=/usr/local/bin/claude \
    CLAUDE_CODE_TIMEOUT_MS=250000 \
    HOME=/tmp/claude-home \
    CLAUDE_CONFIG_DIR=/tmp/claude-config

CMD ["cloud/aws/lambda-handler.handler"]
