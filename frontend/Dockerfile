FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV VITE_API_URL=/api/v1
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# Human: Template is rendered at startup so upload limits stay aligned with MAX_UPLOAD_BYTES.
# Agent: nginx entrypoint envsubst writes /etc/nginx/conf.d/default.conf from this template.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
