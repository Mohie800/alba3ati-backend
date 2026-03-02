const mongoose = require("mongoose");
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
    discussionTime: { type: Number, default: 1 },
    gamePhase: { type: String, default: "lobby" },
    gameResult: { type: String, default: null },

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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Room", RoomSchema);
