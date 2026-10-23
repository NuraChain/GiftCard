import { EntitySchema } from 'typeorm';

// The shop's tables, described to TypeORM.
//
// As EntitySchema objects rather than decorated classes: the server runs as `node src/main.ts`
// under Node's own type stripping, which refuses a decorator outright. Nothing reads a row
// through these - the query modules speak SQL and declare the shapes they read themselves - so
// a row here is only a record of columns.
//
// The tables are made by the migration in ./migrations, which can say what TypeORM cannot: a
// partial index, a DESC key. Every index it makes is named here with `synchronize: false`, so
// the schema TypeORM sees and the one the migration built cannot drift apart without the suite
// noticing (see tests/store.spec.ts).

type Row = Record<string, unknown>;

const Codes = new EntitySchema<Row>({
    name: 'codes',
    columns: {
        id: { type: 'bigint', primary: true, generated: 'increment' },
        amount: { type: 'integer' },
        code: { type: 'text' },
        order_id: { type: 'text', nullable: true },
        hold_until: { type: 'bigint', nullable: true },
        added_at: { type: 'text' }
    },
    indices: [
        { name: 'codes_code', columns: ['code'], unique: true, synchronize: false },
        { name: 'codes_free', columns: ['amount', 'id'], synchronize: false },
        { name: 'codes_by_order', columns: ['order_id'], synchronize: false },
        { name: 'codes_held', columns: ['hold_until'], synchronize: false }
    ]
});

const Orders = new EntitySchema<Row>({
    name: 'orders',
    columns: {
        id: { type: 'text', primary: true },
        authority: { type: 'text', nullable: true },
        amount: { type: 'integer' },
        toman: { type: 'bigint' },
        phone: { type: 'text' },
        status: { type: 'text' },
        code: { type: 'text', nullable: true },
        ref_id: { type: 'bigint', nullable: true },
        sms_delivered: { type: 'boolean' },
        created_at: { type: 'text' },
        settled_at: { type: 'text', nullable: true },
        lang: { type: 'text' }
    },
    indices: [
        { name: 'orders_by_authority', columns: ['authority'], unique: true, synchronize: false },
        { name: 'orders_recent', columns: ['created_at'], synchronize: false },
        { name: 'orders_by_code', columns: ['code'], synchronize: false },
        { name: 'orders_owed', columns: ['status', 'code'], synchronize: false }
    ]
});

const GatewayPayments = new EntitySchema<Row>({
    name: 'gateway_payments',
    columns: {
        id: { type: 'bigint', primary: true, generated: 'increment' },
        authority: { type: 'text' },
        payment_id: { type: 'text' }
    },
    indices: [
        {
            name: 'gateway_payments_pair',
            columns: ['authority', 'payment_id'],
            unique: true,
            synchronize: false
        }
    ]
});

const Redemptions = new EntitySchema<Row>({
    name: 'redemptions',
    columns: {
        code: { type: 'text', primary: true },
        amount: { type: 'integer' },
        wallet: { type: 'text' },
        network: { type: 'text' },
        phone: { type: 'text' },
        notified: { type: 'boolean' },
        claimed_at: { type: 'text' }
    },
    indices: [
        { name: 'redemptions_pending', columns: ['notified', 'claimed_at'], synchronize: false }
    ]
});

const Settings = new EntitySchema<Row>({
    name: 'settings',
    columns: {
        key: { type: 'text', primary: true },
        value: { type: 'text' }
    }
});

const SettingsLog = new EntitySchema<Row>({
    name: 'settings_log',
    columns: {
        id: { type: 'bigint', primary: true, generated: 'increment' },
        key: { type: 'text' },
        before: { type: 'text' },
        after: { type: 'text' },
        changed_at: { type: 'text' }
    }
});

const Tiers = new EntitySchema<Row>({
    name: 'tiers',
    columns: {
        amount: { type: 'integer', primary: true },
        title: { type: 'text' },
        blurb: { type: 'text' },
        title_en: { type: 'text' },
        blurb_en: { type: 'text' },
        recommended: { type: 'boolean' },
        active: { type: 'boolean' },
        sort: { type: 'integer' }
    }
});

export const ENTITIES = [Codes, Orders, GatewayPayments, Redemptions, Settings, SettingsLog, Tiers];
