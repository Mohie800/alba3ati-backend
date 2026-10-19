const mongoose = require("mongoose");
const { EventEmitter } = require("events");
const RoomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true },
    host: { type: String, required: true },
    players: [
      {
        player: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        roleId: { type: String || null, default: null },
        status: { type: String, enum: ["alive", "dead"], default: "alive" },
        night: { type: Number, default: 1 },
        kills: { type: Number, default: 0 },
        target: { type: String || null, default: null },
        playStatus: {
          type: String,
          enum: ["playing", "done"],
          default: "playing",
        },
        leftMidGame: { type: Boolean, default: false },
      },
    ],
    status: {
      type: String,
      enum: ["waiting", "playing", "ended"],
      default: "waiting",
    },
    roundNumber: { type: Number, default: 1 },
    votes: [{ type: String, ref: "User" }],
    activePlayers: { type: Number, default: 0 },
    isPublic: { type: Boolean, default: false },
    isQuickPlay: { type: Boolean, default: false },
    discussionTime: { type: Number, default: 1 },
    votesVisible: { type: Boolean, default: false },
    deadChat: { type: Boolean, default: false },
    gamePhase: { type: String, default: "lobby" },
    // When the current timed phase ends; null for phases that wait on players.
    phaseEndsAt: { type: Date, default: null },
    gameResult: { type: String, default: null },
    // Rematches reuse this document; these keep what earlier games in the room did
    gamesCompleted: { type: Number, default: 0 },
    gameHistory: [
      {
        _id: false,
        result: String,
        endedAt: Date,
        playerCount: Number,
        rounds: Number,
      },
    ],
    // Discussion/phase state kept on the room so it survives a restart.
    skipVotes: [{ type: String }],
    mutedPlayers: [{ type: String }],
    roleDeclarations: { type: Map, of: String, default: {} },
    publicRoomReadyNotifiedAt: { type: Date, default: null },

    //actions
    ba3atiTargets: [{ player: { type: String }, target: { type: String } }],
    al3omdaTargets: [{ player: { type: String }, target: { type: String } }],
    damazeenTargets: [{ player: { type: String }, target: { type: String } }],
    damazeenProtection: { type: Boolean, default: false },
    damazeenAttackUsedBy: [{ type: String }],
    damazeenProtectUsedBy: [{ type: String }],
    lastAl3omdaTargets: { type: Map, of: String, default: {} },
    sitAlwada3Targets: [{ player: { type: String }, target: { type: String } }],
    abuJanzeerTargets: [{ player: { type: String }, target: { type: String } }],
    ballahTargets: [{ player: { type: String }, target: { type: String } }],
    ballahAttackUsedBy: [{ type: String }],
    ba3atiKabeerTargets: [
      { player: { type: String }, target: { type: String } },
    ],
    ba3atiKabeerConvertTargets: [
      { player: { type: String }, target: { type: String } },
    ],
    ba3atiKabeerConvertUsedBy: [{ type: String }],
    jenabuTargets: [
      {
        player: { type: String },
        target1: { type: String },
        target2: { type: String },
      },
    ],
    wadAlzalatTargets: [{ player: { type: String }, target: { type: String } }],
    wadAlzalatUsedBy: [{ type: String }],
    rematchAccepted: [{ type: String }],
    spectators: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

RoomSchema.index({ status: 1, isPublic: 1 });
RoomSchema.index({ isQuickPlay: 1, status: 1 });
// Stale-room cleanup: { status: $in, activePlayers: 0, updatedAt: $lt }
// runs every 5 min in socket.io.js. Status prefix + updatedAt range filter.
RoomSchema.index({ status: 1, updatedAt: -1 });
// "home" event DB fallback + per-user room lookup:
// Room.findOne({ status: $in, "players.player": playerId })
// "players.player" is multikey; status is scalar — safe compound.
// roomId already has a unique index from `unique: true`, so it's not re-declared here.
RoomSchema.index({ "players.player": 1, status: 1 });

// Entries whose User was deleted populate to null; clients would crash on them.
RoomSchema.set("toJSON", {
  transform(doc, ret) {
    if (Array.isArray(ret.players)) ret.players = ret.players.filter((p) => p.player);
    return ret;
  },
});

// Emits ("statusChanged", roomId, status) after any save that changes status.
const roomEvents = new EventEmitter();
RoomSchema.pre("save", function () {
  this.$locals.statusChanged = this.isNew || this.isModified("status");
});
RoomSchema.post("save", function (doc) {
  if (doc.$locals.statusChanged) {
    roomEvents.emit("statusChanged", doc.roomId, doc.status);
  }
});

module.exports = mongoose.model("Room", RoomSchema);
module.exports.roomEvents = roomEvents;
