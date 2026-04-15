FROM node:20-slim

WORKDIR /app

# Install dependencies needed for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

# Generate Prisma client
RUN npx prisma generate

EXPOSE 3000

# We use ts-node and nodemon for development
CMD ["npm", "run", "dev"]
