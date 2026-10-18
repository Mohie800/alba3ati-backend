const Room = require("../models/room.model");
const { cancelTimer, setPhase, startPhaseTimer } = require("./timer.game");
const { NIGHT_RESULTS_TIME } = require("../../utils/constants");
const { PLAYER_POPULATE, pidOf } = require("./roomUtils");

// Resolves the night. Runs under the room lock; the phase guard makes a second
// trigger (timer expiry racing the last action) a no-op.
module.exports.claculateResult = async (io, roomId) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room || room.status !== "playing" || room.gamePhase !== "night") {
      return null;
    }
    // Stop the night timer first so no stray tick reaches clients after
    // "timeout" (a tick during nightResults flips the client to discussion).
    cancelTimer(roomId);

    // Snapshot who is alive BEFORE kill resolution
    const wasAlive = {};
    room.players.forEach((p) => {
      wasAlive[pidOf(p)] = p.status;
    });

    // Extract player IDs from ba3atiTargets and al3omdaTargets
    const ba3atiTargets = room.ba3atiTargets.map((t) => t.target);
    const al3omdatargets = new Set(room.al3omdaTargets.map((t) => t.target)); // Use a Set for fast lookup

    // A successful Ba3ati Kabeer conversion takes priority over Ba3ati-team kills.
    // If target is valid for conversion this night (not protected), they should be converted, not killed by ba3ati attacks.
    const ba3atiKabeerConvertSafeTargets = new Set();
    if (!room.damazeenProtection) {
      room.ba3atiKabeerConvertTargets.forEach((entry) => {
        const target = room.players.find(
          (p) => pidOf(p) === entry.target,
        );
        if (!target || target.status === "dead") return;
        if (al3omdatargets.has(entry.target)) return;
        if (target.roleId === "1" || target.roleId === "7") return;
        ba3atiKabeerConvertSafeTargets.add(entry.target);
      });
    }

    // Update players in ba3atiTargets but not in al3omdaTargets
    if (!room.damazeenProtection) {
      room.players.forEach((player) => {
        if (player.status === "dead") return;
        if (
          ba3atiTargets.includes(pidOf(player)) &&
          !ba3atiKabeerConvertSafeTargets.has(pidOf(player)) &&
          !al3omdatargets.has(pidOf(player))
        ) {
          player.status = "dead"; // Mark as dead
        }
      });
    }

    //damazeen action
    const damazeenTargets = room.damazeenTargets.map((t) => t.target);
    room.players.forEach((player) => {
      if (player.status === "dead") return;
      if (damazeenTargets.includes(pidOf(player))) {
        player.status = "dead"; // Mark as dead
      }
    });

    // Ba3ati Kabeer kill — same blocking rules as regular ba3ati (blocked by al3omda + damazeen protection)
    const ba3atiKabeerKillTargets = room.ba3atiKabeerTargets.map(
      (t) => t.target,
    );
    if (!room.damazeenProtection) {
      room.players.forEach((player) => {
        if (player.status === "dead") return;
        if (
          ba3atiKabeerKillTargets.includes(pidOf(player)) &&
          !ba3atiKabeerConvertSafeTargets.has(pidOf(player)) &&
          !al3omdatargets.has(pidOf(player))
        ) {
          player.status = "dead";
        }
      });
    }

    // Snapshot after ba3ati/damazeen/ba3atiKabeer kills, before ballah/abuJanzeer
    const beforeBallah = {};
    room.players.forEach((p) => {
      beforeBallah[pidOf(p)] = p.status;
    });

    // Ballah Abu Seif kills — unblockable (not affected by omda or damazeen protection)
    const ballahKills = [];
    room.ballahTargets.forEach((entry) => {
      const victim = room.players.find(
        (p) => pidOf(p) === entry.target,
      );
      if (!victim) return;

      victim.status = "dead";

      const killer = room.players.find(
        (p) => pidOf(p) === entry.player,
      );
      ballahKills.push({
        victimId: entry.target,
        victimName: victim.player.name,
        killerId: entry.player,
        killerName: killer?.player.name || "???",
      });
    });

    // Wad Alzalat — water splash (unblockable, once per match)
    const wadAlzalatResults = [];
    room.wadAlzalatTargets.forEach((entry) => {
      const target = room.players.find(
        (p) => pidOf(p) === entry.target,
      );
      const wadPlayer = room.players.find(
        (p) => pidOf(p) === entry.player,
      );
      if (!target || !wadPlayer) return;

      const targetRoleId = target.roleId;
      const isBa3atiTeam = targetRoleId === "1" || targetRoleId === "7";

      if (isBa3atiTeam) {
        // Success — target dies
        target.status = "dead";
        wadAlzalatResults.push({
          wadPlayerId: entry.player,
          wadPlayerName: wadPlayer.player.name,
          success: true,
        });
      } else {
        // Failure — Wad Alzalat dies
        wadPlayer.status = "dead";
        wadAlzalatResults.push({
          wadPlayerId: entry.player,
          wadPlayerName: wadPlayer.player.name,
          success: false,
        });
      }
    });

    // Abu Janzeer kills — unblockable (not affected by omda or damazeen protection).
    // Tracked independently of other kill phases: any target alive at the start of the
    // night gets attributed to Abu Janzeer, even if Ballah/ba3ati hit the same player.
    const abuJanzeerTargets = room.abuJanzeerTargets.map((t) => t.target);
    const abuJanzeerDead = [];
    abuJanzeerTargets.forEach((targetId) => {
      if (wasAlive[targetId] !== "alive") return;
      abuJanzeerDead.push(targetId);
      const player = room.players.find(
        (p) => pidOf(p) === targetId,
      );
      if (player && player.status === "alive") {
        player.status = "dead";
      }
    });

    // Ba3ati Kabeer convert — converts target to ba3ati (roleId "1") if not protected
    const ba3atiKabeerConverted = [];
    room.ba3atiKabeerConvertTargets.forEach((entry) => {
      const target = room.players.find(
        (p) => pidOf(p) === entry.target,
      );
      if (!target || target.status === "dead") return;
      // Blocked by al3omda protection and damazeen protection
      if (room.damazeenProtection) return;
      if (al3omdatargets.has(entry.target)) return;
      if (target.roleId === "1" || target.roleId === "7") return;
      // Convert target to ba3ati
      target.roleId = "1";
      ba3atiKabeerConverted.push({
        targetId: entry.target,
        targetName: target.player.name,
      });
    });

    // Determine who died from ba3ati/damazeen (regular deaths — before ballah snapshot)
    const newlyDead = room.players
      .filter(
        (p) =>
          wasAlive[pidOf(p)] === "alive" &&
          beforeBallah[pidOf(p)] === "dead",
      )
      .map((p) => pidOf(p));

    // Remember each al3omda's target this night (for next-round restriction)
    const newLastTargets = {};
    room.al3omdaTargets.forEach((t) => {
      newLastTargets[t.player] = t.target;
    });
    room.lastAl3omdaTargets = newLastTargets;

    // Save the updated room
    room.players.forEach((P) => {
      P.playStatus = "playing";
    });
    setPhase(room, "nightResults", NIGHT_RESULTS_TIME);
    await room.save();
    io.to(roomId).emit("timeout", {
      room,
      newlyDead,
      abuJanzeerDead,
      ballahKills,
      ba3atiKabeerConverted,
      wadAlzalatResults,
    });
    io.to(roomId).emit("stopTimer");
    startPhaseTimer(io, room);

    return room; // Return the updated room
  } catch (error) {
    console.error("Error updating player status:", error);
    return null;
  }
};
