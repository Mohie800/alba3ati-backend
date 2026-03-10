const mongoose = require("mongoose");
const config = require("../config/config");
const Room = require("../api/models/room.model");
const GameRound = require("../api/models/gameRound.model");

// Rooms older than this threshold are considered stale
const STALE_HOURS = parseInt(process.env.FLUSH_STALE_HOURS) || 6;

async function flushStaleRooms() {
  try {
    await mongoose.connect(config.mongo.uri);
    console.log("Connected to MongoDB");

    const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
    console.log(`Flushing rooms older than ${STALE_HOURS} hours (before ${cutoff.toISOString()})\n`);

    // 1. Find stale waiting rooms
    const staleWaiting = await Room.find({
      status: "waiting",
      updatedAt: { $lt: cutoff },
    }).select("roomId players activePlayers createdAt updatedAt");

    // 2. Find stale playing rooms
    const stalePlaying = await Room.find({
      status: "playing",
      updatedAt: { $lt: cutoff },
    }).select("roomId players activePlayers createdAt updatedAt");

    console.log(`Found ${staleWaiting.length} stale waiting rooms`);
    console.log(`Found ${stalePlaying.length} stale playing rooms\n`);

    if (staleWaiting.length === 0 && stalePlaying.length === 0) {
      console.log("Nothing to flush.");
      process.exit(0);
    }

    // Log details
    for (const room of staleWaiting) {
      console.log(`  [WAITING] ${room.roomId} | ${room.players.length} players | active: ${room.activePlayers} | updated: ${room.updatedAt.toISOString()}`);
    }
    for (const room of stalePlaying) {
      console.log(`  [PLAYING] ${room.roomId} | ${room.players.length} players | active: ${room.activePlayers} | updated: ${room.updatedAt.toISOString()}`);
    }

    // 3. End all stale rooms
    const staleRoomIds = [
      ...staleWaiting.map((r) => r.roomId),
      ...stalePlaying.map((r) => r.roomId),
    ];

    const roomResult = await Room.updateMany(
      { roomId: { $in: staleRoomIds } },
      { $set: { status: "ended", activePlayers: 0 } }
    );

    console.log(`\nMarked ${roomResult.modifiedCount} rooms as ended`);

    // 4. Complete any stale game rounds for these rooms
    const roundResult = await GameRound.updateMany(
      {
        roomId: { $in: staleRoomIds },
        status: { $in: ["pending", "active"] },
      },
      { $set: { status: "completed" } }
    );

    console.log(`Marked ${roundResult.modifiedCount} game rounds as completed`);

    // 5. Summary
    console.log("\n--- Summary ---");
    console.log(`Waiting rooms flushed:  ${staleWaiting.length}`);
    console.log(`Playing rooms flushed:  ${stalePlaying.length}`);
    console.log(`Game rounds completed:  ${roundResult.modifiedCount}`);
    console.log("Done.");

    process.exit(0);
  } catch (err) {
    console.error("Flush failed:", err.message);
    process.exit(1);
  }
}

flushStaleRooms();
