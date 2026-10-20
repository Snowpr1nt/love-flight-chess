import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const flightGuests = sqliteTable('flight_guests', {
  id: text('id').primaryKey(), tokenHash: text('token_hash').notNull().unique(),
  profile: text('profile').notNull(), expiresAt: integer('expires_at').notNull(),
});
export const flightRooms = sqliteTable('flight_rooms', {
  id: text('id').primaryKey(), code: text('code').notNull().unique(),
  revision: integer('revision').notNull(), document: text('document').notNull(), expiresAt: integer('expires_at').notNull(),
});
export const flightCommands = sqliteTable('flight_commands', {
  roomId: text('room_id').notNull(), playerId: text('player_id').notNull(), actionId: text('action_id').notNull(),
  fingerprint: text('fingerprint').notNull(), result: text('result').notNull(), expiresAt: integer('expires_at').notNull(),
}, table => [primaryKey({columns:[table.roomId,table.playerId,table.actionId]})]);
export const flightPresence = sqliteTable('flight_presence', {
  roomId: text('room_id').notNull(), playerId: text('player_id').notNull(), lastSeen: integer('last_seen').notNull(),
}, table => [primaryKey({columns:[table.roomId,table.playerId]})]);
export const flightLimits = sqliteTable('flight_limits', {
  id: text('id').primaryKey(), bucket: integer('bucket').notNull(), hits: integer('hits').notNull(),
});
