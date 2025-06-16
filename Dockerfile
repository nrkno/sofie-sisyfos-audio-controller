# BUILD IMAGE
FROM node:18.16-alpine
RUN apk add --no-cache git

RUN corepack enable
RUN corepack prepare yarn@4.1.0 --activate

WORKDIR /opt/sisyfos-audio-controller

COPY . .
RUN yarn install
RUN yarn build
RUN yarn workspaces focus --all --production
RUN yarn cache clean

# DEPLOY IMAGE
FROM node:18.16-alpine
# Install corepack and use yarn 4.1.0
RUN corepack enable
RUN corepack prepare yarn@4.1.0 --activate
WORKDIR /opt/sisyfos-audio-controller
COPY --from=0 /opt/sisyfos-audio-controller .
EXPOSE 1176/tcp
EXPOSE 1176/udp
EXPOSE 5255/tcp
EXPOSE 5255/udp
ENV NODE_ENV=production
ENV LOG_LEVEL=trace
CMD ["node", "server/dist/server"]
