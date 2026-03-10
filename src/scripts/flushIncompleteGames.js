const mongoose = require("mongoose");
const config = require("../config/config");
const Room = require("../api/models/room.model");
const GameRound = require("../api/models/gameRound.model");

async function flushIncompleteGames() {
  try {
    await mongoose.connect(config.mongo.uri);
    console.log("Connected to MongoDB");

    // Find ended rooms with no game result (never reached a win condition)
    const incompleteRooms = await Room.find({
      status: "ended",
      $or: [{ gameResult: null }, { gameResult: "" }],
    }).select("roomId players activePlayers gamePhase createdAt updatedAt");

    console.log(`Found ${incompleteRooms.length} incomplete ended games\n`);

    if (incompleteRooms.length === 0) {
      console.log("Nothing to flush.");
      process.exit(0);
    }

    for (const room of incompleteRooms) {
      console.log(`  ${room.roomId} | ${room.players.length} players | phase: ${room.gamePhase} | created: ${room.createdAt.toISOString()}`);
    }

    const roomIds = incompleteRooms.map((r) => r.roomId);

    // Delete the incomplete rooms
    const roomResult = await Room.deleteMany({
      roomId: { $in: roomIds },
    });

    console.log(`\nDeleted ${roomResult.deletedCount} incomplete rooms`);

    // Delete associated game rounds
    const roundResult = await GameRound.deleteMany({
      roomId: { $in: roomIds },
    });

    console.log(`Deleted ${roundResult.deletedCount} associated game rounds`);

    console.log("\nDone.");
    process.exit(0);
  } catch (err) {
    console.error("Flush failed:", err.message);
    process.exit(1);
  }
}

flushIncompleteGames();
