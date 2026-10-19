import type { Category, ComponentKind, Protocol } from './types';

export interface ProtocolInfo {
  label: string;
  color: string;
  /** Synchronous request/response (contributes to latency chains and sync cycles). */
  sync: boolean;
  description: string;
}

export const PROTOCOL_INFO: Record<Protocol, ProtocolInfo> = {
  https: { label: 'HTTPS', color: '#3b82f6', sync: true, description: 'REST/JSON over HTTPS' },
  grpc: { label: 'gRPC', color: '#0ea5e9', sync: true, description: 'gRPC / Protobuf' },
  graphql: { label: 'GraphQL', color: '#e535ab', sync: true, description: 'GraphQL over HTTPS' },
  websocket: { label: 'WebSocket', color: '#6366f1', sync: false, description: 'Bi-directional WebSocket stream' },
  sql: { label: 'SQL', color: '#d97706', sync: true, description: 'SQL wire protocol' },
  nosql: { label: 'NoSQL', color: '#b45309', sync: true, description: 'Document database driver' },
  kv: { label: 'Key-Value', color: '#dc2626', sync: true, description: 'Key-value / cache protocol (RESP)' },
  search: { label: 'Search', color: '#ca8a04', sync: true, description: 'Search / query DSL' },
  blob: { label: 'Object', color: '#65a30d', sync: true, description: 'Object storage API (S3-compatible)' },
  amqp: { label: 'AMQP', color: '#9333ea', sync: false, description: 'Message queue (AMQP / MQ)' },
  kafka: { label: 'Kafka', color: '#7c3aed', sync: false, description: 'Event stream (Kafka protocol)' },
  mqtt: { label: 'MQTT', color: '#a855f7', sync: false, description: 'MQTT device messaging' },
  oidc: { label: 'OIDC', color: '#0f766e', sync: true, description: 'OpenID Connect / OAuth 2.0' },
  smtp: { label: 'SMTP', color: '#be185d', sync: false, description: 'Email delivery' },
  otlp: { label: 'OTLP', color: '#64748b', sync: false, description: 'OpenTelemetry traces, metrics, logs' },
  sftp: { label: 'SFTP', color: '#78716c', sync: false, description: 'Batch file transfer' },
  hl7: { label: 'HL7/FHIR', color: '#e11d48', sync: false, description: 'Healthcare messaging (HL7 v2 / FHIR)' },
};

/** Platform plumbing protocols; hidden when showing "business links" only. */
export const PLATFORM_PROTOCOLS: ReadonlySet<Protocol> = new Set<Protocol>(['otlp', 'oidc']);

export interface CategoryInfo {
  label: string;
  color: string;
  order: number;
  description: string;
}

export const CATEGORY_INFO: Record<Category, CategoryInfo> = {
  experience: { label: 'Experience', color: '#5b7cfa', order: 0, description: 'Channels people and devices use' },
  edge: { label: 'Edge', color: '#f08a3c', order: 1, description: 'Traffic entry, routing and protection' },
  application: { label: 'Application', color: '#2fae8f', order: 2, description: 'Business services and workers' },
  integration: { label: 'Integration', color: '#9b6be0', order: 3, description: 'Messaging and integration backbone' },
  data: { label: 'Data', color: '#e2ac3f', order: 4, description: 'Stores, indexes, analytics and models' },
  platform: { label: 'Platform', color: '#7d8a9e', order: 5, description: 'Identity, secrets and observability' },
  external: { label: 'External', color: '#d9777a', order: 6, description: 'Third-party, partner and legacy systems' },
};

export type BlockShape = 'box' | 'cylinder';

export interface BlockGeometry {
  shape: BlockShape;
  /** Footprint in cell units (box: width along x, depth along y; cylinder: w = diameter). */
  w: number;
  d: number;
  h: number;
  /** Optional cap block on top (towers). */
  cap?: { w: number; d: number; h: number };
}

export interface KindInfo {
  label: string;
  category: Category;
  provides: Protocol[];
  consumes: Protocol[];
  geometry: BlockGeometry;
  defaultTech: string;
  techOptions: string[];
  /** Rough monthly run cost per replica (USD), for the parts list. */
  costPerReplica: number;
  /** Words the offline editor understands when someone says "add a …". */
  synonyms: string[];
  /** Short glyph used in compact UI. */
  glyph: string;
}

const box = (w: number, d: number, h: number, cap?: BlockGeometry['cap']): BlockGeometry => ({
  shape: 'box',
  w,
  d,
  h,
  cap,
});
const cyl = (diameter: number, h: number): BlockGeometry => ({ shape: 'cylinder', w: diameter, d: diameter, h });

const APP_CONSUMES: Protocol[] = [
  'https',
  'grpc',
  'graphql',
  'sql',
  'nosql',
  'kv',
  'search',
  'blob',
  'amqp',
  'kafka',
  'oidc',
  'smtp',
  'otlp',
  'sftp',
  'hl7',
];

export const KIND_INFO: Record<ComponentKind, KindInfo> = {
  'web-app': {
    label: 'Web App',
    category: 'experience',
    provides: [],
    consumes: ['https', 'graphql', 'websocket', 'oidc'],
    geometry: box(0.78, 0.6, 0.5),
    defaultTech: 'React SPA',
    techOptions: ['React SPA', 'Next.js', 'Angular', 'Vue', 'Svelte'],
    costPerReplica: 0,
    synonyms: ['web app', 'webapp', 'website', 'web portal', 'portal', 'frontend', 'storefront', 'spa', 'dashboard ui'],
    glyph: '▭',
  },
  'mobile-app': {
    label: 'Mobile App',
    category: 'experience',
    provides: [],
    consumes: ['https', 'graphql', 'websocket', 'oidc'],
    geometry: box(0.42, 0.66, 0.5),
    defaultTech: 'React Native',
    techOptions: ['React Native', 'Swift / Kotlin', 'Flutter'],
    costPerReplica: 0,
    synonyms: ['mobile app', 'mobile', 'ios app', 'android app', 'phone app'],
    glyph: '▯',
  },
  device: {
    label: 'Device Fleet',
    category: 'experience',
    provides: [],
    consumes: ['mqtt', 'https'],
    geometry: box(0.5, 0.5, 0.32),
    defaultTech: 'Embedded Linux',
    techOptions: ['Embedded Linux', 'Zephyr RTOS', 'Android Things', 'PLC gateway'],
    costPerReplica: 0,
    synonyms: ['device', 'devices', 'sensor', 'sensors', 'device fleet', 'iot devices', 'vehicles'],
    glyph: '◫',
  },
  cdn: {
    label: 'CDN',
    category: 'edge',
    provides: ['https'],
    consumes: ['https', 'blob'],
    geometry: box(0.82, 0.82, 0.26),
    defaultTech: 'Cloudflare',
    techOptions: ['Cloudflare', 'Amazon CloudFront', 'Azure Front Door', 'Akamai', 'Fastly'],
    costPerReplica: 300,
    synonyms: ['cdn', 'content delivery', 'edge cache'],
    glyph: '⌂',
  },
  'api-gateway': {
    label: 'API Gateway',
    category: 'edge',
    provides: ['https', 'graphql', 'websocket'],
    consumes: ['https', 'grpc', 'graphql', 'websocket', 'oidc', 'otlp'],
    geometry: box(0.56, 0.56, 1.45, { w: 0.74, d: 0.74, h: 0.16 }),
    defaultTech: 'Kong Gateway',
    techOptions: ['Kong Gateway', 'Amazon API Gateway', 'Azure API Management', 'Apigee', 'Envoy Gateway'],
    costPerReplica: 450,
    synonyms: ['api gateway', 'gateway', 'api management', 'apim', 'ingress'],
    glyph: '⛩',
  },
  'load-balancer': {
    label: 'Load Balancer',
    category: 'edge',
    provides: ['https', 'grpc'],
    consumes: ['https', 'grpc'],
    geometry: box(0.82, 0.48, 0.28),
    defaultTech: 'NGINX',
    techOptions: ['NGINX', 'HAProxy', 'AWS ALB', 'Azure Load Balancer', 'F5 BIG-IP'],
    costPerReplica: 120,
    synonyms: ['load balancer', 'lb', 'reverse proxy'],
    glyph: '⇆',
  },
  bff: {
    label: 'Backend for Frontend',
    category: 'application',
    provides: ['https', 'graphql', 'websocket'],
    consumes: ['https', 'grpc', 'graphql', 'kv', 'kafka', 'oidc', 'otlp'],
    geometry: box(0.7, 0.7, 0.75),
    defaultTech: 'Node.js (GraphQL)',
    techOptions: ['Node.js (GraphQL)', 'Apollo Router', 'Spring Boot', 'Go'],
    costPerReplica: 180,
    synonyms: ['bff', 'backend for frontend', 'graphql layer', 'experience api'],
    glyph: '⧉',
  },
  service: {
    label: 'Service',
    category: 'application',
    provides: ['https', 'grpc'],
    consumes: APP_CONSUMES,
    geometry: box(0.72, 0.72, 0.9),
    defaultTech: 'Spring Boot',
    techOptions: ['Spring Boot', 'Node.js (NestJS)', 'Go', 'ASP.NET Core', 'Python (FastAPI)', 'Kotlin (Ktor)'],
    costPerReplica: 220,
    synonyms: ['service', 'microservice', 'api', 'backend', 'server', 'module'],
    glyph: '■',
  },
  function: {
    label: 'Function',
    category: 'application',
    provides: ['https'],
    consumes: ['https', 'grpc', 'sql', 'nosql', 'kv', 'blob', 'amqp', 'kafka', 'smtp', 'otlp'],
    geometry: box(0.5, 0.5, 0.55),
    defaultTech: 'AWS Lambda',
    techOptions: ['AWS Lambda', 'Azure Functions', 'Google Cloud Functions', 'Cloudflare Workers'],
    costPerReplica: 40,
    synonyms: ['function', 'lambda', 'serverless function', 'cloud function'],
    glyph: 'ƒ',
  },
  worker: {
    label: 'Worker',
    category: 'application',
    provides: [],
    consumes: APP_CONSUMES,
    geometry: box(0.7, 0.7, 0.62),
    defaultTech: 'Go worker',
    techOptions: ['Go worker', 'Spring Batch', 'Celery', 'Sidekiq', 'Apache Flink', 'Node.js worker'],
    costPerReplica: 160,
    synonyms: ['worker', 'background job', 'consumer', 'job runner', 'batch job', 'processor', 'stream processor'],
    glyph: '⚙',
  },
  workflow: {
    label: 'Workflow Engine',
    category: 'application',
    provides: ['https', 'grpc'],
    consumes: ['https', 'grpc', 'sql', 'amqp', 'kafka', 'otlp'],
    geometry: box(0.72, 0.72, 0.8),
    defaultTech: 'Temporal',
    techOptions: ['Temporal', 'Camunda 8', 'AWS Step Functions', 'Azure Durable Functions'],
    costPerReplica: 260,
    synonyms: ['workflow', 'workflow engine', 'orchestrator', 'bpm', 'saga', 'approval flow'],
    glyph: '⟳',
  },
  'message-queue': {
    label: 'Message Queue',
    category: 'integration',
    provides: ['amqp'],
    consumes: ['otlp'],
    geometry: box(0.86, 0.42, 0.38),
    defaultTech: 'RabbitMQ',
    techOptions: ['RabbitMQ', 'Amazon SQS', 'Azure Service Bus', 'IBM MQ', 'ActiveMQ'],
    costPerReplica: 150,
    synonyms: ['queue', 'message queue', 'rabbitmq', 'sqs', 'service bus', 'mq'],
    glyph: '≡',
  },
  'event-stream': {
    label: 'Event Stream',
    category: 'integration',
    provides: ['kafka'],
    consumes: ['otlp'],
    geometry: box(0.9, 0.5, 0.46),
    defaultTech: 'Apache Kafka',
    techOptions: ['Apache Kafka', 'Confluent Cloud', 'Amazon MSK', 'Azure Event Hubs', 'Redpanda'],
    costPerReplica: 400,
    synonyms: ['event stream', 'event bus', 'kafka', 'streaming platform', 'event hub', 'pubsub', 'pub/sub'],
    glyph: '⋙',
  },
  'integration-hub': {
    label: 'Integration Hub',
    category: 'integration',
    provides: ['https', 'amqp', 'sftp', 'hl7'],
    consumes: ['https', 'grpc', 'amqp', 'kafka', 'sftp', 'hl7', 'sql', 'smtp', 'otlp'],
    geometry: box(0.8, 0.8, 0.66),
    defaultTech: 'MuleSoft',
    techOptions: ['MuleSoft', 'Apache Camel', 'Boomi', 'Mirth Connect', 'Azure Logic Apps'],
    costPerReplica: 600,
    synonyms: ['integration hub', 'esb', 'ipaas', 'integration engine', 'mulesoft', 'interface engine'],
    glyph: '⨁',
  },
  'iot-hub': {
    label: 'IoT Hub',
    category: 'integration',
    provides: ['mqtt'],
    consumes: ['kafka', 'otlp'],
    geometry: box(0.6, 0.6, 1.05, { w: 0.72, d: 0.72, h: 0.14 }),
    defaultTech: 'EMQX',
    techOptions: ['EMQX', 'AWS IoT Core', 'Azure IoT Hub', 'HiveMQ'],
    costPerReplica: 500,
    synonyms: ['iot hub', 'mqtt broker', 'device gateway', 'iot core'],
    glyph: '⟟',
  },
  'relational-db': {
    label: 'Relational DB',
    category: 'data',
    provides: ['sql'],
    consumes: [],
    geometry: cyl(0.72, 1.0),
    defaultTech: 'PostgreSQL',
    techOptions: ['PostgreSQL', 'Amazon Aurora', 'Azure SQL', 'Oracle', 'MySQL', 'CockroachDB', 'SQL Server'],
    costPerReplica: 380,
    synonyms: ['database', 'db', 'relational database', 'postgres', 'postgresql', 'mysql', 'sql database', 'oracle'],
    glyph: '⛁',
  },
  'document-db': {
    label: 'Document DB',
    category: 'data',
    provides: ['nosql'],
    consumes: [],
    geometry: cyl(0.72, 0.85),
    defaultTech: 'MongoDB',
    techOptions: ['MongoDB', 'Amazon DynamoDB', 'Azure Cosmos DB', 'Couchbase', 'Firestore'],
    costPerReplica: 340,
    synonyms: ['document db', 'nosql', 'mongodb', 'mongo', 'dynamodb', 'cosmos db', 'document store'],
    glyph: '⛁',
  },
  cache: {
    label: 'Cache',
    category: 'data',
    provides: ['kv'],
    consumes: [],
    geometry: cyl(0.66, 0.42),
    defaultTech: 'Redis',
    techOptions: ['Redis', 'Valkey', 'Memcached', 'Amazon ElastiCache', 'Azure Cache for Redis'],
    costPerReplica: 140,
    synonyms: ['cache', 'redis', 'memcached', 'session store', 'feature store', 'key value store'],
    glyph: '◎',
  },
  'object-store': {
    label: 'Object Store',
    category: 'data',
    provides: ['blob'],
    consumes: [],
    geometry: box(0.7, 0.7, 0.55),
    defaultTech: 'Amazon S3',
    techOptions: ['Amazon S3', 'Azure Blob Storage', 'Google Cloud Storage', 'MinIO'],
    costPerReplica: 90,
    synonyms: ['object store', 'object storage', 's3', 'bucket', 'blob storage', 'file storage', 'data lake', 'archive'],
    glyph: '▣',
  },
  'search-index': {
    label: 'Search Index',
    category: 'data',
    provides: ['search'],
    consumes: [],
    geometry: cyl(0.6, 0.9),
    defaultTech: 'OpenSearch',
    techOptions: ['OpenSearch', 'Elasticsearch', 'Algolia', 'Typesense', 'Azure AI Search'],
    costPerReplica: 320,
    synonyms: ['search index', 'search', 'elasticsearch', 'opensearch', 'full text search', 'search engine'],
    glyph: '⌕',
  },
  'time-series-db': {
    label: 'Time-series DB',
    category: 'data',
    provides: ['sql'],
    consumes: [],
    geometry: cyl(0.68, 0.72),
    defaultTech: 'TimescaleDB',
    techOptions: ['TimescaleDB', 'InfluxDB', 'Amazon Timestream', 'QuestDB'],
    costPerReplica: 360,
    synonyms: ['time series db', 'time-series database', 'tsdb', 'timescale', 'influxdb', 'metrics store'],
    glyph: '⛁',
  },
  'data-warehouse': {
    label: 'Data Warehouse',
    category: 'data',
    provides: ['sql'],
    consumes: ['kafka', 'blob'],
    geometry: cyl(0.84, 1.2),
    defaultTech: 'Snowflake',
    techOptions: ['Snowflake', 'BigQuery', 'Amazon Redshift', 'Databricks SQL', 'Azure Synapse'],
    costPerReplica: 1500,
    synonyms: ['data warehouse', 'warehouse', 'snowflake', 'bigquery', 'redshift', 'lakehouse', 'analytics store'],
    glyph: '⛃',
  },
  'ml-model': {
    label: 'ML Model',
    category: 'data',
    provides: ['https', 'grpc'],
    consumes: ['blob', 'kv', 'otlp'],
    geometry: box(0.6, 0.6, 0.7, { w: 0.4, d: 0.4, h: 0.2 }),
    defaultTech: 'SageMaker Endpoint',
    techOptions: ['SageMaker Endpoint', 'Vertex AI Endpoint', 'Azure ML Endpoint', 'KServe', 'Ray Serve'],
    costPerReplica: 900,
    synonyms: ['ml model', 'model', 'machine learning model', 'ai model', 'scoring model', 'llm', 'inference endpoint'],
    glyph: '✦',
  },
  identity: {
    label: 'Identity Provider',
    category: 'platform',
    provides: ['oidc'],
    consumes: ['sql', 'https', 'smtp', 'otlp'],
    geometry: box(0.54, 0.54, 1.15, { w: 0.7, d: 0.7, h: 0.14 }),
    defaultTech: 'Keycloak',
    techOptions: ['Keycloak', 'Okta', 'Microsoft Entra ID', 'Auth0', 'Amazon Cognito', 'Ping Identity'],
    costPerReplica: 350,
    synonyms: ['identity', 'identity provider', 'idp', 'sso', 'auth', 'authentication', 'login', 'keycloak', 'okta'],
    glyph: '⚿',
  },
  observability: {
    label: 'Observability',
    category: 'platform',
    provides: ['otlp'],
    consumes: ['blob'],
    geometry: box(0.76, 0.76, 0.56),
    defaultTech: 'OpenTelemetry + Grafana',
    techOptions: ['OpenTelemetry + Grafana', 'Datadog', 'New Relic', 'Dynatrace', 'Elastic Observability', 'Splunk'],
    costPerReplica: 700,
    synonyms: ['observability', 'monitoring', 'logging', 'tracing', 'apm', 'grafana', 'datadog', 'telemetry stack'],
    glyph: '◉',
  },
  secrets: {
    label: 'Secrets Vault',
    category: 'platform',
    provides: ['https'],
    consumes: ['otlp'],
    geometry: box(0.5, 0.5, 0.5),
    defaultTech: 'HashiCorp Vault',
    techOptions: ['HashiCorp Vault', 'AWS Secrets Manager', 'Azure Key Vault', 'Google Secret Manager'],
    costPerReplica: 120,
    synonyms: ['secrets', 'vault', 'secrets manager', 'key vault', 'kms', 'secret store'],
    glyph: '⚷',
  },
  'external-saas': {
    label: 'External SaaS',
    category: 'external',
    provides: ['https', 'smtp'],
    consumes: ['https'],
    geometry: box(0.72, 0.72, 0.6),
    defaultTech: 'SaaS API',
    techOptions: ['Stripe', 'Twilio', 'SendGrid', 'Salesforce', 'Adyen', 'Onfido', 'Google Maps Platform'],
    costPerReplica: 250,
    synonyms: ['saas', 'external service', 'third party', 'third-party api', 'provider', 'stripe', 'twilio', 'sendgrid'],
    glyph: '☁',
  },
  'partner-api': {
    label: 'Partner System',
    category: 'external',
    provides: ['https', 'sftp'],
    consumes: ['https'],
    geometry: box(0.72, 0.72, 0.6),
    defaultTech: 'Partner REST API',
    techOptions: ['Partner REST API', 'EDI over SFTP', 'SWIFT', 'Open Banking API'],
    costPerReplica: 0,
    synonyms: ['partner', 'partner api', 'partner system', 'supplier', 'carrier api', 'clearinghouse', 'edi'],
    glyph: '⇄',
  },
  'legacy-system': {
    label: 'Legacy System',
    category: 'external',
    provides: ['sftp', 'amqp', 'sql', 'hl7'],
    consumes: ['https', 'sftp'],
    geometry: box(0.8, 0.8, 1.0),
    defaultTech: 'Mainframe (z/OS)',
    techOptions: ['Mainframe (z/OS)', 'SAP ERP', 'Oracle E-Business Suite', 'AS/400', 'Legacy EHR'],
    costPerReplica: 2000,
    synonyms: ['legacy', 'legacy system', 'mainframe', 'erp', 'sap', 'core system', 'as400'],
    glyph: '▤',
  },
};

export const kindInfo = (kind: ComponentKind): KindInfo => KIND_INFO[kind];
export const categoryOf = (kind: ComponentKind): Category => KIND_INFO[kind].category;

/** Runtime components that should emit telemetry when an observability stack exists. */
export const TELEMETRY_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
  'api-gateway',
  'bff',
  'service',
  'function',
  'worker',
  'workflow',
]);

/** Components that are stateful stores (ownership rules apply). */
export const OWNED_STORE_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
  'relational-db',
  'document-db',
  'search-index',
  'time-series-db',
]);

export const DOMAIN_COLORS = [
  '#4f7cff',
  '#16a37f',
  '#f2994a',
  '#a66cff',
  '#e5484d',
  '#0ea5b7',
  '#d4a017',
  '#db5ea8',
  '#5d8a3a',
  '#7b8794',
];

/** Protocols a consumer would pick to talk to a provider, in preference order. */
export function compatibleProtocols(from: ComponentKind, to: ComponentKind): Protocol[] {
  const consumes = new Set(KIND_INFO[from].consumes);
  return KIND_INFO[to].provides.filter((p) => consumes.has(p));
}

export function preferredProtocol(from: ComponentKind, to: ComponentKind): Protocol | null {
  return compatibleProtocols(from, to)[0] ?? null;
}
