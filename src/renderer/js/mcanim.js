// Player animations ported from Minecraft's HumanoidModel.setupAnim (same formulas and constants).
// Axis mapping MC model space -> skinview3d/three.js: x same, y and z flipped,
// so xRot keeps its sign while yRot / zRot / y / z positions are negated.

const PI = Math.PI;

function bobArms(s, ticks) {
  // AnimationUtils.bobArms: idle breathing sway
  const z = Math.cos(ticks * 0.09) * 0.05 + 0.05;
  const x = Math.sin(ticks * 0.067) * 0.05;
  s.rightArm.rotation.z -= z; s.leftArm.rotation.z += z;
  s.rightArm.rotation.x += x; s.leftArm.rotation.x -= x;
}

function limbs(s, swing, amount) {
  s.rightArm.rotation.x = Math.cos(swing * 0.6662 + PI) * 2 * amount * 0.5;
  s.leftArm.rotation.x = Math.cos(swing * 0.6662) * 2 * amount * 0.5;
  s.rightLeg.rotation.x = Math.cos(swing * 0.6662) * 1.4 * amount;
  s.leftLeg.rotation.x = Math.cos(swing * 0.6662 + PI) * 1.4 * amount;
}

function look(player, s, lk, k = 1) {
  if (!lk) return;
  // inventory screen: body turns atan(x/40)*20deg, head atan(x/40)*40deg, pitch atan(y/40)*20deg
  const yaw = Math.atan(lk.x * 1.6) * (20 / 180 * PI) * k;
  player.rotation.y = yaw;
  s.head.rotation.y = yaw;
  s.head.rotation.x = Math.atan(lk.y * 1.6) * (20 / 180 * PI) * k;
}

function crouchPose(s) {
  // HumanoidModel crouching (1.20+): body leans 0.5 rad around the neck, everything drops 3.2
  const lean = 0.5;
  s.body.rotation.x = lean;
  s.body.position.y = -3.2 - 6 * Math.cos(lean);
  s.body.position.z = -6 * Math.sin(lean);
  s.head.position.y = -4.2;
  s.rightArm.position.y = -5.2; s.leftArm.position.y = -5.2;
  s.rightArm.rotation.x += 0.4; s.leftArm.rotation.x += 0.4;
  s.rightLeg.position.z = -4; s.leftLeg.position.z = -4;
  s.rightLeg.position.y = -12.2; s.leftLeg.position.y = -12.2;
}

function attack(player, s, f) {
  // HumanoidModel.setupAttackAnimation, right hand, f = attackTime 0..1
  const byr = Math.sin(Math.sqrt(f) * PI * 2) * 0.2;
  s.body.rotation.y = -byr;
  s.rightArm.position.z = -Math.sin(byr) * 5; s.rightArm.position.x = -Math.cos(byr) * 5;
  s.leftArm.position.z = Math.sin(byr) * 5; s.leftArm.position.x = Math.cos(byr) * 5;
  s.rightArm.rotation.y -= byr; s.leftArm.rotation.y -= byr; s.leftArm.rotation.x += byr;
  let f2 = 1 - f; f2 = f2 * f2 * f2 * f2;
  const f3 = Math.sin((1 - f2) * PI);
  const f4 = Math.sin(f * PI) * -(s.head.rotation.x - 0.7) * 0.75;
  s.rightArm.rotation.x -= f3 * 1.2 + f4;
  s.rightArm.rotation.y -= byr * 2;
  s.rightArm.rotation.z -= Math.sin(f * PI) * -0.4;
}

function reset(player) {
  player.skin.resetJoints();
  player.rotation.set(0, 0, 0);
  player.position.set(0, 0, 0);
  if (player.cape) { player.cape.rotation.x = 10.8 * PI / 180; player.cape.position.set(0, 8, -2); }
}

// kinds: idle, walk, run, crouch, attack, sit
export function mcAnimation(kind, getLook) {
  return new skinview3d.FunctionAnimation((player, progress) => {
    reset(player);
    const s = player.skin;
    const ticks = progress * 20;
    const lk = getLook ? getLook() : null;
    if (kind === 'idle') {
      look(player, s, lk);
      bobArms(s, ticks);
    } else if (kind === 'walk') {
      limbs(s, ticks * 0.75, 0.75);
      bobArms(s, ticks);
      look(player, s, lk, 0.5);
      if (player.cape) player.cape.rotation.x = 10.8 * PI / 180 + 0.25 + Math.sin(ticks * 0.5) * 0.04;
    } else if (kind === 'run') {
      limbs(s, ticks * 1.15, 1);
      bobArms(s, ticks);
      if (player.cape) player.cape.rotation.x = 10.8 * PI / 180 + 0.6 + Math.sin(ticks * 0.7) * 0.06;
    } else if (kind === 'crouch') {
      look(player, s, lk, 0.6);
      // slow sneak-walk like holding shift and moving
      limbs(s, ticks * 0.3, 0.35);
      bobArms(s, ticks);
      crouchPose(s);
      if (player.cape) { player.cape.position.y = 8 - 1.85; player.cape.rotation.x = 10.8 * PI / 180 + 0.3; player.cape.position.z = -2 + 0.3; }
    } else if (kind === 'attack') {
      look(player, s, lk, 0.4);
      bobArms(s, ticks);
      const cycle = (progress % 0.9) / 0.3; // swing lasts 6 ticks (0.3 s), then a short pause
      if (cycle < 1) attack(player, s, cycle);
    } else if (kind === 'sit') {
      // riding pose
      look(player, s, lk, 0.6);
      s.rightArm.rotation.x = -PI / 5; s.leftArm.rotation.x = -PI / 5;
      s.rightLeg.rotation.x = -1.4137167; s.rightLeg.rotation.y = -PI / 10; s.rightLeg.rotation.z = -0.07853982;
      s.leftLeg.rotation.x = -1.4137167; s.leftLeg.rotation.y = PI / 10; s.leftLeg.rotation.z = 0.07853982;
      player.position.y = -6;
      bobArms(s, ticks);
    }
  });
}
