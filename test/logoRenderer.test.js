const assert = require("node:assert/strict");
const test = require("node:test");
const { PNG } = require("pngjs");

const { renderPngLogo } = require("../src/logoRenderer");

test("renders a larger 1:1 logo on a full-width centered raster canvas", () => {
  const png = new PNG({ width: 8, height: 8 });
  png.data.fill(255);
  for (let index = 0; index < png.width * png.height; index += 1) {
    png.data[index * 4] = 0;
    png.data[index * 4 + 1] = 0;
    png.data[index * 4 + 2] = 0;
    png.data[index * 4 + 3] = 255;
  }

  const logo = renderPngLogo(PNG.sync.write(png));

  assert.equal(logo[0], 0x1b);
  assert.equal(logo[1], 0x61);
  assert.equal(logo[2], 0x00);
  assert.equal(logo[3], 0x1d);
  assert.equal(logo[4], 0x76);
  assert.equal(logo[7] + logo[8] * 256, 48);
  assert.equal(logo[9] + logo[10] * 256, 128);

  const raster = logo.subarray(11, 11 + 48 * 128);
  const middleRow = raster.subarray(64 * 48, 65 * 48);
  assert.equal(middleRow.subarray(0, 16).some((value) => value !== 0), false);
  assert.equal(middleRow.subarray(16, 32).every((value) => value === 0xff), true);
  assert.equal(middleRow.subarray(32).some((value) => value !== 0), false);
});
