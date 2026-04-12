FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/highcourt.db

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "run", "start"]
