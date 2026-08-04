// THE wire vocabulary - one declaration, both sides of the wire.
//
// The server's routes validate against these shapes (features/*/feature.ts) and the application
// imports the same modules for its forms and its row types. Read THIS file for the whole surface;
// read one features/*/schemas.ts for a single feature's shapes, beside the feature.ts that
// declares the routes carrying them.
//
// CLIENT-SAFE BY CONSTRUCTION, and that is a property of every module re-exported here, not just
// this one. A schemas module may import `@azerothjs/schema` and `domain/` - nothing else.
// Reaching for the store, a service or a gateway would drag the whole server into the browser
// bundle. Route declarations and handlers live in feature.ts precisely so this stays true.
export * from './domain/amount.ts';
export * from './features/checkout/schemas.ts';
export * from './features/console/schemas.ts';
export * from './features/catalogue/schemas.ts';
export * from './features/inventory/schemas.ts';
export * from './features/settings/schemas.ts';
