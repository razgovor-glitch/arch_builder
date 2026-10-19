import type { ComponentKind, Lifecycle, Protocol } from '../model/types';

/**
 * Blueprint kits for the offline designer. A kit is a sub-build: one domain with
 * its parts and the joints between them. References starting with `@` point at
 * parts in other kits (shared plumbing such as `@gateway` or `@bus`).
 */

export interface KitPart {
  key: string;
  kind: ComponentKind;
  name: string;
  tech?: string;
  replicas?: number;
  tier?: 1 | 2 | 3;
  alias?: string;
  lifecycle?: Lifecycle;
  description?: string;
}

export interface KitLink {
  from: string;
  to: string;
  protocol?: Protocol;
  label?: string;
  /** Skip silently when the referenced alias is not part of this build. */
  optional?: boolean;
}

export interface Kit {
  id: string;
  domain: string;
  description: string;
  parts: KitPart[];
  links: KitLink[];
  /** Parts the API gateway routes to. */
  expose?: string[];
}

const part = (key: string, kind: ComponentKind, name: string, extra: Partial<KitPart> = {}): KitPart => ({
  key,
  kind,
  name,
  ...extra,
});
const link = (from: string, to: string, protocol?: Protocol, label = '', optional = false): KitLink => ({
  from,
  to,
  protocol,
  label,
  optional,
});

/** Shared plumbing pulled in automatically when a kit references it. */
export const SHARED_ALIASES: Record<string, string> = {
  '@identity': 'platform',
  '@secrets': 'platform',
  '@observability': 'platform',
  '@gateway': 'edge',
  '@cdn': 'edge',
  '@bus': 'integration',
};

export const KITS: Record<string, Kit> = {
  // ---------------------------------------------------------------- shared
  platform: {
    id: 'platform',
    domain: 'Platform & Security',
    description: 'Identity, secrets and observability every other sub-build plugs into.',
    parts: [
      part('identity', 'identity', 'Identity Provider', { tier: 1, replicas: 2, alias: '@identity' }),
      part('identity-db', 'relational-db', 'Identity Store', { tier: 1, replicas: 2 }),
      part('secrets', 'secrets', 'Secrets Vault', { tier: 1, replicas: 3, alias: '@secrets' }),
      part('observability', 'observability', 'Observability Stack', { tier: 2, replicas: 1, alias: '@observability' }),
      part('telemetry-archive', 'object-store', 'Telemetry Archive', { tier: 3 }),
    ],
    links: [
      link('identity', 'identity-db', 'sql', 'users, sessions, clients'),
      link('identity', 'observability', 'otlp', 'auth events'),
      link('secrets', 'observability', 'otlp', 'audit log'),
      link('observability', 'telemetry-archive', 'blob', 'long-term retention'),
    ],
  },
  edge: {
    id: 'edge',
    domain: 'Edge & Access',
    description: 'The front door: TLS, caching, routing, rate limits and token checks.',
    parts: [
      part('gateway', 'api-gateway', 'API Gateway', { tier: 1, replicas: 3, alias: '@gateway' }),
      part('cdn', 'cdn', 'CDN', { tier: 2, alias: '@cdn' }),
      part('assets', 'object-store', 'Static Assets', { alias: '@assets' }),
    ],
    links: [link('gateway', '@identity', 'oidc', 'validates tokens'), link('cdn', 'assets', 'blob', 'static origin')],
  },
  integration: {
    id: 'integration',
    domain: 'Integration Backbone',
    description: 'Durable event backbone that decouples the sub-builds.',
    parts: [
      part('bus', 'event-stream', 'Event Bus', { tier: 1, replicas: 3, alias: '@bus' }),
      part('schema-registry', 'service', 'Schema Registry', { tech: 'Confluent Schema Registry', tier: 1, replicas: 2 }),
    ],
    links: [link('schema-registry', 'bus', 'kafka', 'stores event schemas'), link('bus', '@observability', 'otlp', 'broker metrics')],
  },

  // ------------------------------------------------------------ capabilities
  search: {
    id: 'search',
    domain: 'Search',
    description: 'Full-text and faceted search kept fresh from domain events.',
    parts: [
      part('search-api', 'service', 'Search API', { tier: 2 }),
      part('indexer', 'worker', 'Search Indexer'),
      part('index', 'search-index', 'Search Index', { tier: 2, replicas: 2 }),
    ],
    links: [
      link('search-api', 'index', 'search', 'queries'),
      link('indexer', '@bus', 'kafka', 'consumes change events'),
      link('indexer', 'index', 'search', 'upserts documents'),
    ],
    expose: ['search-api'],
  },
  recommendations: {
    id: 'recommendations',
    domain: 'Personalization',
    description: 'Real-time recommendations from a feature store and a ranking model.',
    parts: [
      part('reco', 'service', 'Recommendation Service', { tech: 'Python (FastAPI)' }),
      part('ranker', 'ml-model', 'Ranking Model'),
      part('features', 'cache', 'Feature Store', { tech: 'Redis' }),
      part('feature-pipeline', 'worker', 'Feature Pipeline', { tech: 'Apache Flink' }),
      part('model-registry', 'object-store', 'Model Registry', { tech: 'MLflow on S3' }),
    ],
    links: [
      link('reco', 'ranker', 'grpc', 'scores candidates'),
      link('reco', 'features', 'kv', 'reads user features'),
      link('ranker', 'model-registry', 'blob', 'loads model versions'),
      link('feature-pipeline', '@bus', 'kafka', 'consumes behaviour events'),
      link('feature-pipeline', 'features', 'kv', 'writes features'),
    ],
    expose: ['reco'],
  },
  notifications: {
    id: 'notifications',
    domain: 'Notifications',
    description: 'Turns domain events into email, SMS and push messages.',
    parts: [
      part('dispatcher', 'worker', 'Notification Dispatcher'),
      part('preferences', 'document-db', 'Notification Preferences', { tech: 'MongoDB' }),
      part('email', 'external-saas', 'Email Provider', { tech: 'SendGrid' }),
      part('sms-push', 'external-saas', 'SMS & Push Provider', { tech: 'Twilio' }),
    ],
    links: [
      link('dispatcher', '@bus', 'kafka', 'consumes notification events'),
      link('dispatcher', 'preferences', 'nosql', 'opt-ins and templates'),
      link('dispatcher', 'email', 'smtp', 'transactional email'),
      link('dispatcher', 'sms-push', 'https', 'SMS and push'),
    ],
  },
  analytics: {
    id: 'analytics',
    domain: 'Analytics & Insights',
    description: 'Event streams land in a lake and warehouse for reporting.',
    parts: [
      part('ingest', 'worker', 'Stream Ingestion', { tech: 'Apache Flink' }),
      part('lake', 'object-store', 'Data Lake'),
      part('warehouse', 'data-warehouse', 'Data Warehouse', { tier: 2 }),
      part('bi', 'service', 'BI Workbench', { tech: 'Apache Superset' }),
    ],
    links: [
      link('ingest', '@bus', 'kafka', 'consumes all events'),
      link('ingest', 'lake', 'blob', 'writes raw partitions'),
      link('warehouse', 'lake', 'blob', 'loads curated tables'),
      link('bi', 'warehouse', 'sql', 'reports and dashboards'),
    ],
    expose: ['bi'],
  },
  fraud: {
    id: 'fraud',
    domain: 'Risk & Fraud',
    description: 'Scores transactions in real time and routes suspicious ones to investigators.',
    parts: [
      part('scoring', 'service', 'Fraud Scoring', { tier: 1, replicas: 3, alias: '@fraud' }),
      part('model', 'ml-model', 'Fraud Model', { tier: 1, replicas: 2 }),
      part('signals', 'cache', 'Risk Signals Cache', { tier: 1, replicas: 2 }),
      part('cases', 'workflow', 'Case Management', { tech: 'Camunda 8' }),
      part('cases-db', 'relational-db', 'Cases DB'),
    ],
    links: [
      link('scoring', 'model', 'grpc', 'risk inference'),
      link('scoring', 'signals', 'kv', 'velocity counters'),
      link('scoring', '@bus', 'kafka', 'publishes risk.scored'),
      link('cases', '@bus', 'kafka', 'consumes risk.scored'),
      link('cases', 'cases-db', 'sql', 'investigations'),
    ],
    expose: ['cases'],
  },
  audit: {
    id: 'audit',
    domain: 'Audit & Compliance',
    description: 'Tamper-evident audit trail and regulatory reporting.',
    parts: [
      part('recorder', 'worker', 'Audit Recorder'),
      part('audit-store', 'object-store', 'Immutable Audit Store', { tech: 'S3 Object Lock' }),
      part('reporting', 'service', 'Compliance Reporting'),
    ],
    links: [
      link('recorder', '@bus', 'kafka', 'consumes every event'),
      link('recorder', 'audit-store', 'blob', 'WORM writes'),
      link('reporting', 'audit-store', 'blob', 'evidence exports'),
    ],
    expose: ['reporting'],
  },
  partner: {
    id: 'partner',
    domain: 'Partner APIs',
    description: 'Public APIs, a developer portal and outbound webhooks.',
    parts: [
      part('portal', 'web-app', 'Developer Portal', { tech: 'Next.js' }),
      part('webhooks', 'worker', 'Webhook Dispatcher'),
      part('partner-endpoints', 'partner-api', 'Partner Endpoints'),
    ],
    links: [
      link('portal', '@gateway', 'https', 'API keys and docs'),
      link('portal', '@identity', 'oidc', 'partner sign-in'),
      link('webhooks', '@bus', 'kafka', 'consumes subscribed events'),
      link('webhooks', 'partner-endpoints', 'https', 'signed callbacks'),
    ],
  },
  realtime: {
    id: 'realtime',
    domain: 'Realtime',
    description: 'Pushes live updates to connected clients over WebSockets.',
    parts: [
      part('hub', 'bff', 'Realtime Hub', { tech: 'Node.js (Socket.IO)', tier: 2, replicas: 3 }),
      part('presence', 'cache', 'Presence Store', { tech: 'Redis' }),
    ],
    links: [
      link('@gateway', 'hub', 'websocket', 'live channel'),
      link('hub', 'presence', 'kv', 'presence and fan-out'),
      link('hub', '@bus', 'kafka', 'subscribes to updates'),
    ],
  },
  workflow: {
    id: 'workflow',
    domain: 'Workflow & Approvals',
    description: 'Long-running business processes with human approval steps.',
    parts: [
      part('engine', 'workflow', 'Approval Workflows', { tech: 'Camunda 8' }),
      part('wf-db', 'relational-db', 'Workflow DB'),
    ],
    links: [link('engine', 'wf-db', 'sql', 'process state'), link('engine', '@bus', 'kafka', 'publishes task events')],
    expose: ['engine'],
  },
  legacy: {
    id: 'legacy',
    domain: 'Legacy Integration',
    description: 'An anti-corruption layer around the system of record.',
    parts: [
      part('hub', 'integration-hub', 'Integration Hub', { tier: 1, replicas: 2 }),
      part('adapter', 'service', 'Legacy Adapter', { tier: 1, replicas: 2 }),
      part('legacy', 'legacy-system', 'ERP System', { tech: 'SAP ERP', lifecycle: 'live' }),
    ],
    links: [
      link('adapter', 'hub', 'https', 'canonical requests'),
      link('hub', 'legacy', 'amqp', 'IDoc / MQ messages'),
      link('hub', '@bus', 'kafka', 'publishes change data'),
      link('hub', '@observability', 'otlp', 'flow monitoring'),
    ],
    expose: ['adapter'],
  },

  // ------------------------------------------------------------- commerce
  catalog: {
    id: 'catalog',
    domain: 'Catalog',
    description: 'Products, prices and media.',
    parts: [
      part('catalog', 'service', 'Catalog Service', { tier: 1 }),
      part('catalog-db', 'relational-db', 'Catalog DB', { tier: 1 }),
      part('media', 'object-store', 'Product Media'),
    ],
    links: [
      link('catalog', 'catalog-db', 'sql', 'products and prices'),
      link('catalog', 'media', 'blob', 'images and video'),
      link('catalog', '@bus', 'kafka', 'publishes product.changed'),
    ],
    expose: ['catalog'],
  },
  cart: {
    id: 'cart',
    domain: 'Cart & Checkout',
    description: 'Baskets and the checkout saga.',
    parts: [
      part('cart', 'service', 'Cart Service', { tech: 'Go', tier: 1 }),
      part('cart-store', 'cache', 'Cart Store', { tier: 1, replicas: 2 }),
      part('checkout', 'workflow', 'Checkout Orchestrator', { tier: 1 }),
    ],
    links: [
      link('cart', 'cart-store', 'kv', 'baskets'),
      link('checkout', 'cart', 'grpc', 'reads basket'),
      link('checkout', '@orders', 'grpc', 'places order'),
      link('checkout', '@payments', 'grpc', 'authorizes payment'),
    ],
    expose: ['cart', 'checkout'],
  },
  orders: {
    id: 'orders',
    domain: 'Orders',
    description: 'Order lifecycle from placement to completion.',
    parts: [
      part('orders', 'service', 'Order Service', { tier: 1, alias: '@orders' }),
      part('orders-db', 'relational-db', 'Orders DB', { tier: 1 }),
    ],
    links: [link('orders', 'orders-db', 'sql', 'orders and lines'), link('orders', '@bus', 'kafka', 'publishes order.placed')],
    expose: ['orders'],
  },
  payments: {
    id: 'payments',
    domain: 'Payments',
    description: 'Authorizations, captures and refunds through the payment provider.',
    parts: [
      part('payments', 'service', 'Payment Service', { tier: 1, alias: '@payments' }),
      part('payments-db', 'relational-db', 'Payments Ledger', { tier: 1 }),
      part('psp', 'external-saas', 'Payment Provider', { tech: 'Stripe' }),
    ],
    links: [
      link('payments', 'payments-db', 'sql', 'payment intents'),
      link('payments', 'psp', 'https', 'authorize and capture'),
      link('payments', '@secrets', 'https', 'provider keys'),
      link('payments', '@bus', 'kafka', 'publishes payment.captured'),
      link('payments', '@fraud', 'grpc', 'risk check', true),
    ],
  },
  inventory: {
    id: 'inventory',
    domain: 'Inventory',
    description: 'Stock levels and reservations.',
    parts: [part('inventory', 'service', 'Inventory Service'), part('inventory-db', 'relational-db', 'Inventory DB')],
    links: [
      link('inventory', 'inventory-db', 'sql', 'stock and reservations'),
      link('inventory', '@bus', 'kafka', 'consumes order.placed'),
    ],
    expose: ['inventory'],
  },
  fulfillment: {
    id: 'fulfillment',
    domain: 'Fulfillment',
    description: 'Picks, packs and ships paid orders.',
    parts: [
      part('fulfillment', 'worker', 'Fulfillment Worker'),
      part('shipments-db', 'relational-db', 'Shipments DB'),
      part('carriers', 'partner-api', 'Carrier APIs', { tech: 'UPS / DHL APIs' }),
    ],
    links: [
      link('fulfillment', '@bus', 'kafka', 'consumes payment.captured'),
      link('fulfillment', 'shipments-db', 'sql', 'shipments'),
      link('fulfillment', 'carriers', 'https', 'labels and tracking'),
    ],
  },
  customers: {
    id: 'customers',
    domain: 'Customers',
    description: 'Customer profiles, addresses and consent.',
    parts: [
      part('customers', 'service', 'Customer Profile Service'),
      part('customers-db', 'document-db', 'Customer Profiles'),
    ],
    links: [
      link('customers', 'customers-db', 'nosql', 'profiles and addresses'),
      link('customers', '@bus', 'kafka', 'publishes customer.updated'),
    ],
    expose: ['customers'],
  },

  // -------------------------------------------------------------- banking
  accounts: {
    id: 'accounts',
    domain: 'Accounts',
    description: 'Customer accounts, balances and statements.',
    parts: [
      part('accounts', 'service', 'Accounts Service', { tier: 1 }),
      part('accounts-db', 'relational-db', 'Accounts DB', { tier: 1 }),
    ],
    links: [
      link('accounts', 'accounts-db', 'sql', 'accounts and limits'),
      link('accounts', '@ledger', 'grpc', 'reads balances'),
      link('accounts', '@bus', 'kafka', 'publishes account.opened'),
    ],
    expose: ['accounts'],
  },
  ledger: {
    id: 'ledger',
    domain: 'Core Ledger',
    description: 'Double-entry ledger; the source of truth for money movement.',
    parts: [
      part('ledger', 'service', 'Ledger Service', { tier: 1, replicas: 3, alias: '@ledger' }),
      part('ledger-db', 'relational-db', 'Ledger DB', { tech: 'CockroachDB', tier: 1, replicas: 3 }),
    ],
    links: [link('ledger', 'ledger-db', 'sql', 'postings'), link('ledger', '@bus', 'kafka', 'publishes posting.created')],
  },
  'bank-payments': {
    id: 'bank-payments',
    domain: 'Payments',
    description: 'Transfers, card authorizations and scheme connectivity.',
    parts: [
      part('payments-hub', 'service', 'Payments Hub', { tier: 1, replicas: 3 }),
      part('payments-db', 'relational-db', 'Payments DB', { tier: 1 }),
      part('rails', 'partner-api', 'Payment Rails', { tech: 'SWIFT / SEPA' }),
      part('card-processor', 'external-saas', 'Card Processor', { tech: 'Marqeta' }),
    ],
    links: [
      link('payments-hub', 'payments-db', 'sql', 'payment orders'),
      link('payments-hub', 'rails', 'https', 'clears transfers'),
      link('payments-hub', 'card-processor', 'https', 'card authorizations'),
      link('payments-hub', '@ledger', 'grpc', 'posts entries'),
      link('payments-hub', '@fraud', 'grpc', 'risk check', true),
      link('payments-hub', '@bus', 'kafka', 'publishes payment.settled'),
    ],
    expose: ['payments-hub'],
  },
  kyc: {
    id: 'kyc',
    domain: 'Onboarding & KYC',
    description: 'Digital onboarding with identity verification.',
    parts: [
      part('onboarding', 'service', 'Onboarding Service'),
      part('applications-db', 'relational-db', 'Applications DB'),
      part('kyc-docs', 'object-store', 'KYC Documents'),
      part('kyc-provider', 'external-saas', 'KYC Provider', { tech: 'Onfido' }),
    ],
    links: [
      link('onboarding', 'applications-db', 'sql', 'applications'),
      link('onboarding', 'kyc-docs', 'blob', 'ID documents'),
      link('onboarding', 'kyc-provider', 'https', 'identity checks'),
      link('onboarding', '@bus', 'kafka', 'publishes customer.verified'),
    ],
    expose: ['onboarding'],
  },
  lending: {
    id: 'lending',
    domain: 'Lending',
    description: 'Loan origination with credit decisioning.',
    parts: [
      part('origination', 'workflow', 'Loan Origination', { tech: 'Camunda 8' }),
      part('loans-db', 'relational-db', 'Loans DB'),
      part('bureau', 'partner-api', 'Credit Bureau', { tech: 'Experian API' }),
    ],
    links: [
      link('origination', 'loans-db', 'sql', 'applications and offers'),
      link('origination', 'bureau', 'https', 'credit reports'),
      link('origination', '@ledger', 'grpc', 'disburses funds'),
      link('origination', '@bus', 'kafka', 'publishes loan.approved'),
    ],
    expose: ['origination'],
  },

  // ----------------------------------------------------------- healthcare
  clinical: {
    id: 'clinical',
    domain: 'Clinical Records',
    description: 'Patient records exposed as FHIR resources.',
    parts: [
      part('fhir', 'service', 'FHIR Server', { tech: 'HAPI FHIR', tier: 1, alias: '@fhir' }),
      part('cdr', 'relational-db', 'Clinical Data Repository', { tier: 1 }),
    ],
    links: [link('fhir', 'cdr', 'sql', 'FHIR resources'), link('fhir', '@bus', 'kafka', 'publishes clinical events')],
    expose: ['fhir'],
  },
  scheduling: {
    id: 'scheduling',
    domain: 'Scheduling',
    description: 'Appointments, slots and reminders.',
    parts: [part('appointments', 'service', 'Appointments Service'), part('appointments-db', 'relational-db', 'Appointments DB')],
    links: [
      link('appointments', 'appointments-db', 'sql', 'slots and bookings'),
      link('appointments', '@fhir', 'https', 'patient lookup'),
      link('appointments', '@bus', 'kafka', 'publishes appointment.booked'),
    ],
    expose: ['appointments'],
  },
  'clinical-integration': {
    id: 'clinical-integration',
    domain: 'Clinical Integration',
    description: 'HL7 interfaces to the hospital EHR and laboratories.',
    parts: [
      part('engine', 'integration-hub', 'HL7 Interface Engine', { tech: 'Mirth Connect', tier: 1, replicas: 2 }),
      part('ehr', 'legacy-system', 'Hospital EHR', { tech: 'Legacy EHR', lifecycle: 'live' }),
      part('labs', 'partner-api', 'Laboratory Systems', { tech: 'Lab results over SFTP' }),
    ],
    links: [
      link('engine', 'ehr', 'hl7', 'ADT and orders feeds'),
      link('engine', 'labs', 'sftp', 'results batches'),
      link('engine', '@fhir', 'https', 'upserts FHIR resources'),
      link('engine', '@observability', 'otlp', 'interface monitoring'),
    ],
  },
  imaging: {
    id: 'imaging',
    domain: 'Imaging',
    description: 'DICOMweb access to the imaging archive.',
    parts: [
      part('imaging-gw', 'service', 'Imaging Gateway', { tech: 'DICOMweb proxy' }),
      part('vna', 'object-store', 'Imaging Archive', { tech: 'Vendor-neutral archive' }),
    ],
    links: [link('imaging-gw', 'vna', 'blob', 'studies and series'), link('imaging-gw', '@fhir', 'https', 'ImagingStudy resources')],
    expose: ['imaging-gw'],
  },
  telehealth: {
    id: 'telehealth',
    domain: 'Telehealth',
    description: 'Virtual visits.',
    parts: [
      part('visits', 'service', 'Virtual Visit Service'),
      part('video', 'external-saas', 'Video Platform', { tech: 'Twilio Video' }),
    ],
    links: [
      link('visits', 'video', 'https', 'video rooms'),
      link('visits', '@fhir', 'https', 'encounters'),
      link('visits', '@bus', 'kafka', 'publishes encounter.closed'),
    ],
    expose: ['visits'],
  },
  claims: {
    id: 'claims',
    domain: 'Revenue Cycle',
    description: 'Claims submission and remittance.',
    parts: [
      part('claims', 'service', 'Claims Service'),
      part('claims-db', 'relational-db', 'Claims DB'),
      part('clearinghouse', 'partner-api', 'Claims Clearinghouse', { tech: 'EDI 837/835 over SFTP' }),
    ],
    links: [
      link('claims', 'claims-db', 'sql', 'claims'),
      link('claims', 'clearinghouse', 'sftp', '837 out / 835 in'),
      link('claims', '@bus', 'kafka', 'consumes encounter.closed'),
    ],
    expose: ['claims'],
  },

  // ------------------------------------------------------------ logistics
  shipments: {
    id: 'shipments',
    domain: 'Shipments',
    description: 'Shipment bookings and milestones.',
    parts: [
      part('shipments', 'service', 'Shipment Service', { tier: 1 }),
      part('shipments-db', 'relational-db', 'Shipments DB', { tier: 1 }),
    ],
    links: [link('shipments', 'shipments-db', 'sql', 'bookings and milestones'), link('shipments', '@bus', 'kafka', 'publishes shipment.updated')],
    expose: ['shipments'],
  },
  tracking: {
    id: 'tracking',
    domain: 'Live Tracking',
    description: 'Vehicle positions from telematics to the map.',
    parts: [
      part('telematics', 'iot-hub', 'Telematics Hub', { tier: 1, replicas: 2, alias: '@iothub' }),
      part('positions', 'worker', 'Position Processor', { tech: 'Apache Flink' }),
      part('positions-db', 'time-series-db', 'Positions TSDB', { tier: 1, replicas: 2 }),
      part('tracking-api', 'service', 'Tracking API'),
    ],
    links: [
      link('telematics', '@bus', 'kafka', 'bridges positions'),
      link('telematics', '@observability', 'otlp', 'connection metrics'),
      link('positions', '@bus', 'kafka', 'consumes positions'),
      link('positions', 'positions-db', 'sql', 'writes tracks'),
      link('tracking-api', 'positions-db', 'sql', 'latest positions'),
    ],
    expose: ['tracking-api'],
  },
  routing: {
    id: 'routing',
    domain: 'Routing & ETA',
    description: 'Route optimisation and predicted arrival times.',
    parts: [
      part('router', 'service', 'Routing Engine'),
      part('eta-model', 'ml-model', 'ETA Model'),
      part('maps', 'external-saas', 'Maps API', { tech: 'Google Maps Platform' }),
    ],
    links: [link('router', 'maps', 'https', 'distance matrix'), link('router', 'eta-model', 'grpc', 'predicts ETA')],
    expose: ['router'],
  },
  fleet: {
    id: 'fleet',
    domain: 'Fleet',
    description: 'Vehicles, drivers and maintenance.',
    parts: [part('fleet', 'service', 'Fleet Service'), part('fleet-db', 'relational-db', 'Fleet DB')],
    links: [link('fleet', 'fleet-db', 'sql', 'vehicles and drivers'), link('fleet', '@bus', 'kafka', 'publishes vehicle.status')],
    expose: ['fleet'],
  },
  warehouse: {
    id: 'warehouse',
    domain: 'Warehouse Ops',
    description: 'Integration with the warehouse management system.',
    parts: [
      part('wms-adapter', 'service', 'WMS Adapter'),
      part('wms', 'legacy-system', 'Warehouse Management', { tech: 'SAP EWM', lifecycle: 'live' }),
    ],
    links: [link('wms-adapter', 'wms', 'amqp', 'IDoc messages'), link('wms-adapter', '@bus', 'kafka', 'publishes stock.moved')],
    expose: ['wms-adapter'],
  },
  carriers: {
    id: 'carriers',
    domain: 'Carrier Network',
    description: 'EDI exchange with carriers and 3PLs.',
    parts: [
      part('edi', 'worker', 'Carrier EDI Gateway'),
      part('carrier-network', 'partner-api', 'Carrier Network', { tech: 'EDI 214/990 over SFTP' }),
    ],
    links: [link('edi', '@bus', 'kafka', 'consumes tender events'), link('edi', 'carrier-network', 'sftp', 'EDI documents')],
  },

  // ------------------------------------------------------------------ IoT
  connectivity: {
    id: 'connectivity',
    domain: 'Device Connectivity',
    description: 'Secure device connections and the device registry.',
    parts: [
      part('device-hub', 'iot-hub', 'Device Hub', { tier: 1, replicas: 3, alias: '@iothub' }),
      part('registry', 'service', 'Device Registry', { tier: 1 }),
      part('registry-db', 'relational-db', 'Registry DB', { tier: 1 }),
    ],
    links: [
      link('device-hub', '@bus', 'kafka', 'bridges telemetry'),
      link('device-hub', '@observability', 'otlp', 'connection metrics'),
      link('registry', 'registry-db', 'sql', 'devices and certificates'),
      link('registry', '@bus', 'kafka', 'publishes device.registered'),
    ],
    expose: ['registry'],
  },
  telemetry: {
    id: 'telemetry',
    domain: 'Telemetry Pipeline',
    description: 'Stream processing into hot and cold storage.',
    parts: [
      part('processor', 'worker', 'Stream Processor', { tech: 'Apache Flink', tier: 1, replicas: 3 }),
      part('tsdb', 'time-series-db', 'Telemetry TSDB', { tier: 1, replicas: 2 }),
      part('raw-lake', 'object-store', 'Raw Telemetry Lake'),
      part('telemetry-api', 'service', 'Telemetry API'),
    ],
    links: [
      link('processor', '@bus', 'kafka', 'consumes telemetry'),
      link('processor', 'tsdb', 'sql', 'hot metrics'),
      link('processor', 'raw-lake', 'blob', 'cold archive'),
      link('telemetry-api', 'tsdb', 'sql', 'queries'),
    ],
    expose: ['telemetry-api'],
  },
  alerting: {
    id: 'alerting',
    domain: 'Alerting & Rules',
    description: 'Threshold rules and anomaly detection.',
    parts: [
      part('rules', 'worker', 'Rules Engine'),
      part('rules-db', 'relational-db', 'Rules DB'),
      part('anomaly', 'ml-model', 'Anomaly Detector'),
    ],
    links: [
      link('rules', '@bus', 'kafka', 'consumes telemetry, publishes alerts'),
      link('rules', 'rules-db', 'sql', 'rule definitions'),
      link('rules', 'anomaly', 'grpc', 'anomaly scores'),
    ],
  },
  twin: {
    id: 'twin',
    domain: 'Digital Twin',
    description: 'Live model of assets and their relationships.',
    parts: [part('twin', 'service', 'Digital Twin Service'), part('twin-db', 'document-db', 'Twin Graph', { tech: 'Azure Cosmos DB' })],
    links: [link('twin', 'twin-db', 'nosql', 'asset graph'), link('twin', '@bus', 'kafka', 'consumes state changes')],
    expose: ['twin'],
  },
  ota: {
    id: 'ota',
    domain: 'Firmware & OTA',
    description: 'Signed firmware releases rolled out over the air.',
    parts: [part('ota', 'service', 'Firmware Service'), part('firmware', 'object-store', 'Firmware Repository')],
    links: [link('ota', 'firmware', 'blob', 'signed images'), link('ota', '@bus', 'kafka', 'publishes rollout commands')],
    expose: ['ota'],
  },

  // ----------------------------------------------------------------- SaaS
  tenancy: {
    id: 'tenancy',
    domain: 'Tenancy & Accounts',
    description: 'Tenants, plans and entitlements.',
    parts: [
      part('tenants', 'service', 'Tenant Service', { tier: 1 }),
      part('tenants-db', 'relational-db', 'Tenant Catalog', { tier: 1 }),
    ],
    links: [link('tenants', 'tenants-db', 'sql', 'tenants and entitlements'), link('tenants', '@bus', 'kafka', 'publishes tenant.created')],
    expose: ['tenants'],
  },
  product: {
    id: 'product',
    domain: 'Core Product',
    description: 'The product API, its data and background jobs.',
    parts: [
      part('api', 'service', 'Product API', { tier: 1, replicas: 3 }),
      part('db', 'relational-db', 'Product DB', { tier: 1 }),
      part('cache', 'cache', 'Query Cache'),
      part('jobs-queue', 'message-queue', 'Job Queue'),
      part('jobs', 'worker', 'Background Jobs'),
    ],
    links: [
      link('api', 'db', 'sql', 'tenant-scoped data'),
      link('api', 'cache', 'kv', 'hot reads'),
      link('api', 'jobs-queue', 'amqp', 'enqueues jobs'),
      link('api', '@bus', 'kafka', 'publishes domain events'),
      link('jobs', 'jobs-queue', 'amqp', 'consumes jobs'),
      link('jobs', 'db', 'sql', 'batch updates'),
    ],
    expose: ['api'],
  },
  billing: {
    id: 'billing',
    domain: 'Billing & Metering',
    description: 'Usage metering, invoicing and subscriptions.',
    parts: [
      part('billing', 'service', 'Billing Service'),
      part('billing-db', 'relational-db', 'Billing DB'),
      part('metering', 'worker', 'Usage Metering'),
      part('billing-provider', 'external-saas', 'Billing Provider', { tech: 'Stripe Billing' }),
    ],
    links: [
      link('billing', 'billing-db', 'sql', 'subscriptions and invoices'),
      link('billing', 'billing-provider', 'https', 'charges'),
      link('metering', '@bus', 'kafka', 'consumes usage events'),
      link('metering', 'billing-db', 'sql', 'usage records'),
    ],
    expose: ['billing'],
  },
  sso: {
    id: 'sso',
    domain: 'Enterprise SSO',
    description: 'SAML/OIDC federation and SCIM provisioning for customer IdPs.',
    parts: [
      part('scim', 'service', 'SCIM Provisioning'),
      part('customer-idps', 'external-saas', 'Customer IdPs', { tech: 'Okta / Entra ID' }),
    ],
    links: [
      link('@identity', 'customer-idps', 'https', 'SAML / OIDC federation'),
      link('scim', '@identity', 'oidc', 'service credentials'),
      link('scim', '@bus', 'kafka', 'publishes user.provisioned'),
    ],
    expose: ['scim'],
  },

  // ---------------------------------------------------------------- media
  content: {
    id: 'content',
    domain: 'Content Catalog',
    description: 'Titles, seasons, artwork and rights windows.',
    parts: [part('content', 'service', 'Content Service'), part('metadata', 'document-db', 'Metadata Store')],
    links: [link('content', 'metadata', 'nosql', 'titles and rights'), link('content', '@bus', 'kafka', 'publishes title.published')],
    expose: ['content'],
  },
  ingest: {
    id: 'ingest',
    domain: 'Ingest & Transcode',
    description: 'Uploads mezzanine files and transcodes renditions.',
    parts: [
      part('upload', 'service', 'Upload Service'),
      part('masters', 'object-store', 'Master Files'),
      part('transcode-queue', 'message-queue', 'Transcode Queue'),
      part('transcoders', 'worker', 'Transcode Workers', { tech: 'FFmpeg', replicas: 6 }),
      part('renditions', 'object-store', 'Renditions', { alias: '@renditions' }),
    ],
    links: [
      link('upload', 'masters', 'blob', 'mezzanine uploads'),
      link('upload', 'transcode-queue', 'amqp', 'transcode jobs'),
      link('transcoders', 'transcode-queue', 'amqp', 'consumes jobs'),
      link('transcoders', 'masters', 'blob', 'reads masters'),
      link('transcoders', 'renditions', 'blob', 'writes HLS/DASH'),
    ],
    expose: ['upload'],
  },
  playback: {
    id: 'playback',
    domain: 'Playback',
    description: 'Entitlement checks, DRM and playback sessions.',
    parts: [
      part('playback', 'service', 'Playback Service', { tier: 1, replicas: 3 }),
      part('sessions', 'cache', 'Playback Sessions', { tier: 1, replicas: 2 }),
      part('drm', 'external-saas', 'DRM License Service', { tech: 'BuyDRM' }),
    ],
    links: [
      link('playback', 'sessions', 'kv', 'concurrent streams'),
      link('playback', 'drm', 'https', 'license tokens'),
      link('playback', '@bus', 'kafka', 'publishes playback.started'),
      link('@cdn', '@renditions', 'blob', 'video segments', true),
    ],
    expose: ['playback'],
  },
  subscriptions: {
    id: 'subscriptions',
    domain: 'Subscriptions',
    description: 'Plans, trials and recurring billing.',
    parts: [
      part('subscriptions', 'service', 'Subscription Service'),
      part('subscriptions-db', 'relational-db', 'Subscriptions DB'),
      part('billing-provider', 'external-saas', 'Billing Provider', { tech: 'Stripe Billing' }),
    ],
    links: [
      link('subscriptions', 'subscriptions-db', 'sql', 'plans and entitlements'),
      link('subscriptions', 'billing-provider', 'https', 'recurring charges'),
      link('subscriptions', '@bus', 'kafka', 'publishes subscription.changed'),
    ],
    expose: ['subscriptions'],
  },

  // ------------------------------------------------------------ insurance
  quotes: {
    id: 'quotes',
    domain: 'Quote & Rate',
    description: 'Quotes priced by the rating engine.',
    parts: [
      part('quoting', 'service', 'Quoting Service'),
      part('rating', 'service', 'Rating Engine', { tech: 'Java rules engine' }),
      part('rates-db', 'relational-db', 'Rate Tables'),
    ],
    links: [
      link('quoting', 'rating', 'grpc', 'prices risk'),
      link('rating', 'rates-db', 'sql', 'rate tables'),
      link('quoting', '@underwriting', 'grpc', 'eligibility', true),
      link('quoting', '@bus', 'kafka', 'publishes quote.issued'),
    ],
    expose: ['quoting'],
  },
  policy: {
    id: 'policy',
    domain: 'Policy Administration',
    description: 'Policy issuance, endorsements and renewals.',
    parts: [
      part('policy', 'service', 'Policy Service', { tier: 1 }),
      part('policy-db', 'relational-db', 'Policy DB', { tier: 1 }),
      part('policy-docs', 'object-store', 'Policy Documents'),
    ],
    links: [
      link('policy', 'policy-db', 'sql', 'policies and endorsements'),
      link('policy', 'policy-docs', 'blob', 'declarations pages'),
      link('policy', '@bus', 'kafka', 'publishes policy.issued'),
    ],
    expose: ['policy'],
  },
  'insurance-claims': {
    id: 'insurance-claims',
    domain: 'Claims',
    description: 'First notice of loss through settlement.',
    parts: [
      part('claims-flow', 'workflow', 'Claims Workflow', { tech: 'Camunda 8' }),
      part('claims-db', 'relational-db', 'Claims DB'),
    ],
    links: [
      link('claims-flow', 'claims-db', 'sql', 'claims and reserves'),
      link('claims-flow', '@bus', 'kafka', 'consumes policy events'),
      link('claims-flow', '@fraud', 'grpc', 'fraud screening', true),
    ],
    expose: ['claims-flow'],
  },
  underwriting: {
    id: 'underwriting',
    domain: 'Underwriting',
    description: 'Automated underwriting with third-party data.',
    parts: [
      part('underwriting', 'service', 'Underwriting Service', { alias: '@underwriting' }),
      part('risk-model', 'ml-model', 'Risk Model'),
      part('data-providers', 'partner-api', 'Third-party Data', { tech: 'MVR / CLUE reports' }),
    ],
    links: [
      link('underwriting', 'risk-model', 'grpc', 'risk score'),
      link('underwriting', 'data-providers', 'https', 'driving and loss history'),
    ],
  },

  // -------------------------------------------------------------- generic
  core: {
    id: 'core',
    domain: 'Core Services',
    description: 'The main business API with its data and background jobs.',
    parts: [
      part('api', 'service', 'Core API', { tier: 1 }),
      part('db', 'relational-db', 'Core DB', { tier: 1 }),
      part('cache', 'cache', 'Cache'),
      part('queue', 'message-queue', 'Job Queue'),
      part('jobs', 'worker', 'Background Jobs'),
    ],
    links: [
      link('api', 'db', 'sql', 'business data'),
      link('api', 'cache', 'kv', 'hot reads'),
      link('api', 'queue', 'amqp', 'enqueues jobs'),
      link('api', '@bus', 'kafka', 'publishes domain events'),
      link('jobs', 'queue', 'amqp', 'consumes jobs'),
      link('jobs', 'db', 'sql', 'batch updates'),
    ],
    expose: ['api'],
  },
};

export interface ChannelSpec {
  key: string;
  kind: 'web-app' | 'mobile-app' | 'device';
  name: string;
  tech?: string;
}

export interface Template {
  id: string;
  name: string;
  keywords: string[];
  kits: string[];
  /** Capability kits included unless the prompt asks for an MVP. */
  defaults: string[];
  channels: ChannelSpec[];
  mobile?: ChannelSpec;
  legacyName?: { name: string; tech: string };
}

export const TEMPLATES: Template[] = [
  {
    id: 'commerce',
    name: 'Commerce Platform',
    keywords: ['ecommerce', 'e-commerce', 'shop', 'store', 'retail', 'marketplace', 'cart', 'checkout', 'catalog', 'product', 'merchant'],
    kits: ['catalog', 'cart', 'orders', 'payments', 'inventory', 'fulfillment', 'customers'],
    defaults: ['search', 'notifications'],
    channels: [{ key: 'web', kind: 'web-app', name: 'Web Storefront', tech: 'Next.js' }],
    mobile: { key: 'mobile', kind: 'mobile-app', name: 'Shopping App' },
    legacyName: { name: 'ERP System', tech: 'SAP ERP' },
  },
  {
    id: 'banking',
    name: 'Digital Banking Platform',
    keywords: ['bank', 'banking', 'fintech', 'ledger', 'loan', 'lending', 'deposit', 'wallet', 'neobank', 'kyc', 'card', 'transfer'],
    kits: ['accounts', 'ledger', 'bank-payments', 'kyc', 'lending'],
    defaults: ['fraud', 'notifications', 'audit'],
    channels: [{ key: 'web', kind: 'web-app', name: 'Online Banking', tech: 'Angular' }],
    mobile: { key: 'mobile', kind: 'mobile-app', name: 'Banking App', tech: 'Swift / Kotlin' },
    legacyName: { name: 'Core Banking Mainframe', tech: 'Mainframe (z/OS)' },
  },
  {
    id: 'healthcare',
    name: 'Care Delivery Platform',
    keywords: ['health', 'healthcare', 'hospital', 'patient', 'clinic', 'clinical', 'ehr', 'emr', 'fhir', 'hl7', 'medical', 'telehealth'],
    kits: ['clinical', 'scheduling', 'clinical-integration', 'imaging', 'telehealth', 'claims'],
    defaults: ['notifications', 'audit'],
    channels: [
      { key: 'portal', kind: 'web-app', name: 'Patient Portal' },
      { key: 'clinician', kind: 'web-app', name: 'Clinician Workspace' },
    ],
    mobile: { key: 'mobile', kind: 'mobile-app', name: 'Patient App' },
  },
  {
    id: 'logistics',
    name: 'Logistics Control Tower',
    keywords: ['logistics', 'shipping', 'shipment', 'delivery', 'fleet', 'freight', 'courier', 'tracking', 'warehouse', 'supply chain', 'transport'],
    kits: ['shipments', 'tracking', 'routing', 'fleet', 'warehouse', 'carriers'],
    defaults: ['notifications', 'analytics'],
    channels: [
      { key: 'console', kind: 'web-app', name: 'Control Tower Console' },
      { key: 'driver', kind: 'mobile-app', name: 'Driver App' },
      { key: 'vehicles', kind: 'device', name: 'Vehicle Telematics', tech: 'Telematics units' },
    ],
  },
  {
    id: 'iot',
    name: 'Industrial IoT Platform',
    keywords: ['iot', 'device', 'devices', 'sensor', 'sensors', 'telemetry', 'factory', 'manufacturing', 'industrial', 'plant', 'smart', 'scada', 'machine'],
    kits: ['connectivity', 'telemetry', 'alerting', 'twin', 'ota'],
    defaults: ['notifications', 'analytics'],
    channels: [
      { key: 'console', kind: 'web-app', name: 'Operations Console' },
      { key: 'devices', kind: 'device', name: 'Field Devices' },
    ],
    mobile: { key: 'mobile', kind: 'mobile-app', name: 'Technician App' },
    legacyName: { name: 'Plant MES', tech: 'Siemens Opcenter' },
  },
  {
    id: 'saas',
    name: 'B2B SaaS Platform',
    keywords: ['saas', 'b2b', 'multi-tenant', 'multitenant', 'tenant', 'subscription', 'crm', 'workspace', 'collaboration'],
    kits: ['tenancy', 'product', 'billing', 'sso'],
    defaults: ['notifications', 'audit', 'partner'],
    channels: [
      { key: 'app', kind: 'web-app', name: 'Customer Web App' },
      { key: 'admin', kind: 'web-app', name: 'Admin Console' },
    ],
    mobile: { key: 'mobile', kind: 'mobile-app', name: 'Mobile App' },
  },
  {
    id: 'media',
    name: 'Streaming Media Platform',
    keywords: ['video', 'streaming', 'media', 'music', 'podcast', 'ott', 'broadcast', 'film', 'tv'],
    kits: ['content', 'ingest', 'playback', 'subscriptions'],
    defaults: ['recommendations', 'analytics', 'notifications'],
    channels: [{ key: 'web', kind: 'web-app', name: 'Web Player' }],
    mobile: { key: 'mobile', kind: 'mobile-app', name: 'Mobile & TV Apps' },
  },
  {
    id: 'insurance',
    name: 'Insurance Core Platform',
    keywords: ['insurance', 'insurer', 'claims', 'policy', 'policies', 'underwriting', 'premium', 'actuarial', 'broker'],
    kits: ['quotes', 'policy', 'insurance-claims', 'underwriting'],
    defaults: ['fraud', 'notifications', 'audit', 'analytics'],
    channels: [
      { key: 'agent', kind: 'web-app', name: 'Agent Portal' },
      { key: 'customer', kind: 'web-app', name: 'Customer Portal' },
    ],
    mobile: { key: 'mobile', kind: 'mobile-app', name: 'Policyholder App' },
    legacyName: { name: 'Legacy Policy Admin', tech: 'AS/400' },
  },
];

export const GENERIC_TEMPLATE: Template = {
  id: 'generic',
  name: 'Enterprise Platform',
  keywords: [],
  kits: ['core'],
  defaults: ['notifications'],
  channels: [{ key: 'web', kind: 'web-app', name: 'Web App' }],
  mobile: { key: 'mobile', kind: 'mobile-app', name: 'Mobile App' },
};

/** Capability kits switched on by words in the prompt. */
export const CAPABILITY_TRIGGERS: { kit: string; pattern: RegExp }[] = [
  { kit: 'search', pattern: /\bsearch|discover|find products/ },
  { kit: 'recommendations', pattern: /recommend|personali[sz]/ },
  { kit: 'notifications', pattern: /notif|e-?mail|\bsms\b|push message|reminder/ },
  { kit: 'analytics', pattern: /analytic|report|dashboard|\bbi\b|insight|warehouse|data platform/ },
  { kit: 'fraud', pattern: /fraud|risk scor|anti-money|\baml\b/ },
  { kit: 'audit', pattern: /audit|complian|gdpr|hipaa|\bsox\b|\bpci\b|regulat/ },
  { kit: 'legacy', pattern: /legacy|mainframe|\berp\b|\bsap\b|as\/?400|cobol|\bmes\b/ },
  { kit: 'partner', pattern: /partner|webhook|open api|public api|developer portal|third[- ]party developers/ },
  { kit: 'realtime', pattern: /real[- ]?time|live updates|\bchat\b|websocket|collaborat/ },
  { kit: 'workflow', pattern: /approval|workflow|case management|back[- ]office process/ },
];

export const CLOUD_TECH: Record<'aws' | 'azure' | 'gcp', Partial<Record<ComponentKind, string>>> = {
  aws: {
    'api-gateway': 'Amazon API Gateway',
    cdn: 'Amazon CloudFront',
    'relational-db': 'Amazon Aurora PostgreSQL',
    'document-db': 'Amazon DynamoDB',
    cache: 'Amazon ElastiCache',
    'object-store': 'Amazon S3',
    'event-stream': 'Amazon MSK',
    'message-queue': 'Amazon SQS',
    'search-index': 'Amazon OpenSearch',
    identity: 'Amazon Cognito',
    observability: 'Amazon CloudWatch + X-Ray',
    secrets: 'AWS Secrets Manager',
    function: 'AWS Lambda',
    workflow: 'AWS Step Functions',
    'data-warehouse': 'Amazon Redshift',
    'ml-model': 'SageMaker Endpoint',
    'iot-hub': 'AWS IoT Core',
    'time-series-db': 'Amazon Timestream',
    'load-balancer': 'AWS ALB',
  },
  azure: {
    'api-gateway': 'Azure API Management',
    cdn: 'Azure Front Door',
    'relational-db': 'Azure Database for PostgreSQL',
    'document-db': 'Azure Cosmos DB',
    cache: 'Azure Cache for Redis',
    'object-store': 'Azure Blob Storage',
    'event-stream': 'Azure Event Hubs',
    'message-queue': 'Azure Service Bus',
    'search-index': 'Azure AI Search',
    identity: 'Microsoft Entra ID',
    observability: 'Azure Monitor + App Insights',
    secrets: 'Azure Key Vault',
    function: 'Azure Functions',
    workflow: 'Azure Durable Functions',
    'data-warehouse': 'Azure Synapse',
    'ml-model': 'Azure ML Endpoint',
    'iot-hub': 'Azure IoT Hub',
    'time-series-db': 'Azure Data Explorer',
    'load-balancer': 'Azure Load Balancer',
  },
  gcp: {
    'api-gateway': 'Apigee',
    cdn: 'Cloud CDN',
    'relational-db': 'Cloud SQL for PostgreSQL',
    'document-db': 'Firestore',
    cache: 'Memorystore for Redis',
    'object-store': 'Google Cloud Storage',
    'event-stream': 'Google Pub/Sub',
    'message-queue': 'Cloud Tasks',
    'search-index': 'Vertex AI Search',
    identity: 'Identity Platform',
    observability: 'Google Cloud Observability',
    secrets: 'Secret Manager',
    function: 'Cloud Run functions',
    workflow: 'Google Workflows',
    'data-warehouse': 'BigQuery',
    'ml-model': 'Vertex AI Endpoint',
    'time-series-db': 'Bigtable',
    'load-balancer': 'Cloud Load Balancing',
  },
};

export const LANGUAGE_TECH: { pattern: RegExp; tech: string }[] = [
  { pattern: /\bjava\b|spring/, tech: 'Spring Boot' },
  { pattern: /kotlin/, tech: 'Kotlin (Ktor)' },
  { pattern: /\bnode|typescript|nestjs|javascript/, tech: 'Node.js (NestJS)' },
  { pattern: /\bgo\b|golang/, tech: 'Go' },
  { pattern: /\.net|c#|csharp|dotnet/, tech: 'ASP.NET Core' },
  { pattern: /python|django|fastapi/, tech: 'Python (FastAPI)' },
];
