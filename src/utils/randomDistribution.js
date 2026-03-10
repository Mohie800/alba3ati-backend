function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getBa3atiCount(total) {
  if (total <= 4) return 1;
  if (total <= 6) return randomInt(1, 2);
  if (total <= 8) return 2;
  if (total <= 10) return randomInt(2, 3);
  if (total <= 12) return 3;
  if (total <= 15) return randomInt(3, 4);
  if (total <= 18) return 4;
  return randomInt(4, 5);
}

function getDamazeenCount(total) {
  if (total <= 8) return 1;
  if (total <= 12) return randomInt(1, 2);
  if (total <= 16) return 2;
  return randomInt(2, 3);
}

function getSitAlwada3Count(total) {
  if (total <= 12) return 1;
  return randomInt(1, 2);
}

function getAbuJanzeerChance(total) {
  if (total <= 4) return 0.15;
  if (total <= 6) return 0.3;
  if (total <= 8) return 0.45;
  if (total <= 10) return 0.6;
  if (total <= 12) return 0.75;
  if (total <= 15) return 0.85;
  return 0.95;
}

function calculateRandomDistribution(totalPlayers, includedRoles) {
  const dist = {
    "1": 0, // ba3ati
    "2": 0, // al3omda
    "3": 0, // damazeen
    "4": 0, // sit alwada3
    "5": 0, // abu janzeer
    "6": 0, // ballah abu seif
  };

  if (totalPlayers < 2) return dist;

  // Ba3ati always included
  dist["1"] = getBa3atiCount(totalPlayers);
  let remaining = totalPlayers - dist["1"];

  // Abu Janzeer: probability scales with player count
  if (includedRoles.abuJanzeer && remaining > 1) {
    if (Math.random() < getAbuJanzeerChance(totalPlayers)) {
      dist["5"] = 1;
      remaining -= 1;
    }
  }

  // Damazeen: scales with player count, cap at 3
  if (includedRoles.damazeen && remaining > 1) {
    const wanted = getDamazeenCount(totalPlayers);
    const canAssign = Math.min(wanted, remaining - 1); // reserve 1 for al3omda
    dist["3"] = canAssign;
    remaining -= canAssign;
  }

  // Ballah Abu Seif: exactly 1 if included (cap at 1 in random mode)
  if (includedRoles.ballah && remaining > 1) {
    dist["6"] = 1;
    remaining -= 1;
  }

  // Sit Alwada3: scales with player count, cap at 2
  if (includedRoles.sitAlwada3 && remaining > 1) {
    const wanted = getSitAlwada3Count(totalPlayers);
    const canAssign = Math.min(wanted, remaining - 1); // reserve 1 for al3omda
    dist["4"] = canAssign;
    remaining -= canAssign;
  }

  // Al3omda fills all remaining slots
  dist["2"] = remaining;

  // Enforce: sit alwada3 never > al3omda
  if (dist["4"] > dist["2"]) {
    const excess = dist["4"] - dist["2"];
    dist["4"] -= excess;
    dist["2"] += excess;
  }

  return dist;
}

module.exports = { calculateRandomDistribution };
