import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const db = new Database(path.join(__dirname, 'drafts.db'))

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS presets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    max_points  INTEGER NOT NULL DEFAULT 10,
    status      TEXT    NOT NULL DEFAULT 'draft',
    assignments TEXT    NOT NULL DEFAULT '{}',
    created_by  TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id         TEXT    NOT NULL UNIQUE,
    name                TEXT    NOT NULL,
    host_id             TEXT    NOT NULL,
    team_size           INTEGER NOT NULL,
    coins               INTEGER NOT NULL,
    tier_slots          TEXT    NOT NULL,
    phase               TEXT    NOT NULL DEFAULT 'lobby',
    pick_order          TEXT,
    current_pick_index  INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS draft_participants (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id     INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    user_id      TEXT    NOT NULL,
    username     TEXT    NOT NULL,
    global_name  TEXT,
    avatar       TEXT,
    joined_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(draft_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS teams (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id  INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    user_id   TEXT    NOT NULL,
    UNIQUE(draft_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS team_pokemon (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    pokemon_id   INTEGER NOT NULL,
    pokemon_name TEXT    NOT NULL,
    tier         TEXT,
    cost         INTEGER,
    pick_order   INTEGER NOT NULL,
    picked_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`)

// Migrations for databases created before these columns existed
for (const stmt of [
  'ALTER TABLE drafts ADD COLUMN pick_order TEXT',
  'ALTER TABLE drafts ADD COLUMN current_pick_index INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE drafts ADD COLUMN max_megas INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE drafts ADD COLUMN discord_instance_id TEXT',
  "ALTER TABLE drafts ADD COLUMN type TEXT NOT NULL DEFAULT 'clasico'",
  'ALTER TABLE drafts ADD COLUMN tier_costs TEXT',
  'ALTER TABLE drafts ADD COLUMN preset_id INTEGER',
  'ALTER TABLE drafts ADD COLUMN preset_assignments TEXT',
  'ALTER TABLE drafts ADD COLUMN min_team_size INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE drafts ADD COLUMN min_bid INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE drafts ADD COLUMN auction_timer INTEGER NOT NULL DEFAULT 10',
  'ALTER TABLE drafts ADD COLUMN guild_id TEXT',
]) {
  try { db.exec(stmt) } catch (_) {}
}
// Backfill discord_instance_id for rows created before multi-draft support
try {
  db.exec(`UPDATE drafts SET discord_instance_id = instance_id WHERE discord_instance_id IS NULL`)
} catch (_) {}

export const getPresetsByInstance = db.prepare(`SELECT id, name, max_points, status, created_at FROM presets WHERE instance_id = ? ORDER BY created_at DESC`)
export const getPresetById        = db.prepare(`SELECT * FROM presets WHERE id = ?`)
export const insertPreset         = db.prepare(`INSERT INTO presets (instance_id, name, max_points, status, assignments, created_by) VALUES (@instance_id, @name, @max_points, @status, @assignments, @created_by)`)
export const updatePreset         = db.prepare(`UPDATE presets SET name = @name, assignments = @assignments, status = @status, updated_at = datetime('now') WHERE id = @id`)
export const deletePreset         = db.prepare(`DELETE FROM presets WHERE id = ?`)

export const getDraftByInstance = db.prepare(`SELECT * FROM drafts WHERE instance_id = ?`)
export const getParticipants    = db.prepare(`SELECT * FROM draft_participants WHERE draft_id = ?`)
export const getActiveDrafts           = db.prepare(`SELECT * FROM drafts WHERE phase != 'complete'`)
export const getActiveDraftsByInstance = db.prepare(`SELECT * FROM drafts WHERE phase != 'complete' AND discord_instance_id = ?`)
export const getActiveDraftsByGuild    = db.prepare(`SELECT * FROM drafts WHERE phase != 'complete' AND guild_id = ?`)

export const insertDraft = db.prepare(`
  INSERT INTO drafts (instance_id, discord_instance_id, guild_id, name, host_id, team_size, min_team_size, min_bid, auction_timer, coins, tier_slots, max_megas, type, tier_costs, preset_id, preset_assignments, phase)
  VALUES (@instance_id, @discord_instance_id, @guild_id, @name, @host_id, @team_size, @min_team_size, @min_bid, @auction_timer, @coins, @tier_slots, @max_megas, @type, @tier_costs, @preset_id, @preset_assignments, @phase)
`)

export const updateDraftGuildId = db.prepare(`UPDATE drafts SET guild_id = ? WHERE instance_id = ? AND guild_id IS NULL`)
export const updateDraftPhase   = db.prepare(`UPDATE drafts SET phase = ? WHERE instance_id = ?`)

export const updatePickState = db.prepare(`
  UPDATE drafts SET phase = @phase, pick_order = @pick_order, current_pick_index = @current_pick_index
  WHERE instance_id = @instance_id
`)

export const upsertParticipant = db.prepare(`
  INSERT OR IGNORE INTO draft_participants (draft_id, user_id, username, global_name, avatar)
  VALUES (@draft_id, @user_id, @username, @global_name, @avatar)
`)

export const insertTeam = db.prepare(`
  INSERT OR IGNORE INTO teams (draft_id, user_id) VALUES (?, ?)
`)

export const getTeamId = db.prepare(`
  SELECT id FROM teams WHERE draft_id = ? AND user_id = ?
`)

export const insertPick = db.prepare(`
  INSERT INTO team_pokemon (team_id, pokemon_id, pokemon_name, tier, cost, pick_order)
  VALUES (@team_id, @pokemon_id, @pokemon_name, @tier, @cost, @pick_order)
`)

export const getTeamPokemon = db.prepare(`
  SELECT tp.* FROM team_pokemon tp
  JOIN teams t ON t.id = tp.team_id
  WHERE t.draft_id = ? AND t.user_id = ?
  ORDER BY pick_order
`)

export const deleteDraft = db.prepare(`DELETE FROM drafts WHERE instance_id = ? AND host_id = ?`)

export const getDraftsByUser = db.prepare(`
  SELECT d.id, d.instance_id, d.name, d.host_id, d.phase, d.team_size, d.coins, d.created_at,
         COUNT(DISTINCT dp2.user_id) AS participant_count
  FROM drafts d
  JOIN draft_participants dp  ON dp.draft_id  = d.id AND dp.user_id = ?
  JOIN draft_participants dp2 ON dp2.draft_id = d.id
  GROUP BY d.id
  ORDER BY d.created_at DESC
`)

export const getTeamsWithPicks = db.prepare(`
  SELECT t.id          AS teamId,
         t.user_id     AS userId,
         dp.username,
         dp.global_name,
         dp.avatar,
         tp.pokemon_id   AS pokemonId,
         tp.pokemon_name AS pokemonName,
         tp.tier,
         tp.cost,
         tp.pick_order   AS pickOrder
  FROM teams t
  JOIN draft_participants dp ON dp.draft_id = t.draft_id AND dp.user_id = t.user_id
  LEFT JOIN team_pokemon tp  ON tp.team_id = t.id
  WHERE t.draft_id = ?
  ORDER BY t.id, tp.pick_order
`)

export const getAllPicksForDraft = db.prepare(`
  SELECT tp.pokemon_id   AS pokemonId,
         tp.pokemon_name AS pokemonName,
         tp.tier,
         tp.cost,
         tp.pick_order   AS pickOrder,
         t.user_id       AS userId
  FROM team_pokemon tp
  JOIN teams t ON t.id = tp.team_id
  WHERE t.draft_id = ?
  ORDER BY tp.pick_order
`)

export default db
