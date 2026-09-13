# Environment variables

Each service owns its own `.env` (never committed — `.gitignore` excludes
`.env*` except `.env.example`). Values below are local-development
defaults; production values are never hardcoded anywhere in source.

## backend/.env

| Variable | Purpose | Local default |
|---|---|---|
| `NODE_ENV` | runtime environment | `development` |
| `PORT` | Express listen port | `4000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/ai-digital-twin` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `REDIS_DEFAULT_TTL_SECONDS` | default cache-aside TTL | `60` |
| `KAFKA_BROKERS` | comma-separated broker list | `localhost:9092` |
| `KAFKA_CLIENT_ID` | KafkaJS client id | `ai-digital-twin-backend` |
| `KAFKA_CONSUMER_GROUP` | default consumer group id | `ai-digital-twin-backend-group` |
| `JWT_SECRET` | JWT signing secret | (generated locally, never committed) |
| `JWT_EXPIRES_IN` | access token lifetime | `1h` |
| `AI_SERVICE_URL` | base URL of the Python AI service | `http://localhost:8000` |
| `LOG_LEVEL` | structured logger level | `info` |
| `RATE_LIMIT_WINDOW_MS` | rate limiter window | `60000` |
| `RATE_LIMIT_MAX` | max requests per window | `100` |

## ai-service/.env

| Variable | Purpose | Local default |
|---|---|---|
| `ENV` | runtime environment | `development` |
| `PORT` | FastAPI listen port | `8000` |
| `LLM_PROVIDER` | LLM provider identifier | `groq` |
| `LLM_MODEL` | Groq-hosted Llama model id (kept configurable since Groq's supported model names change) | (set to the current Groq-hosted Llama model at Phase 9) |
| `GROQ_API_KEY` | Groq API key — server-side only | (never committed) |
| `BACKEND_BASE_URL` | base URL of the Node.js backend tool API | `http://localhost:4000` |
| `QDRANT_URL` | Qdrant connection URL | `http://localhost:6333` |
| `QDRANT_COLLECTION` | collection name for knowledge chunks | `knowledge_base` |
| `EMBEDDING_MODEL` | fastembed model identifier used to turn text into vectors (justified in `ai-service/app/rag/embedding.py`) | `BAAI/bge-small-en-v1.5` |
| `AGENT_MAX_ITERATIONS` | hard cap on tool-call loop iterations | `6` |
| `AGENT_TOOL_TIMEOUT_MS` | per-tool-call timeout | `10000` |
| `LOG_LEVEL` | structured logger level | `info` |

## frontend/.env

| Variable | Purpose | Local default |
|---|---|---|
| `VITE_API_BASE_URL` | base URL of the Node.js backend | `http://localhost:4000` |

Note: the frontend never receives `GROQ_API_KEY`, Mongo/Redis/Kafka
credentials, or `JWT_SECRET` — only the backend's public base URL.
