// Conway's Game of Life on a 96x64 grid, drawn as 2x2 blocks on a 192x128
// display at 0x4000 (one byte per pixel), with a few buttons read from 0x3FFF.
#include <stdint.h>
#include <string.h>

#define WIDTH 96
#define HEIGHT 64
#define SCREEN ((volatile uint8_t *)0x4000)
#define BUTTONS (*(volatile uint8_t *)0x3FFF)

static uint8_t cells[HEIGHT][WIDTH];
static uint8_t next[HEIGHT][WIDTH];
static uint16_t seed = 0xACE1;
static uint16_t generation;

static uint16_t random16(void) {
    // A 16-bit Galois LFSR.
    uint16_t bit = seed & 1;
    seed >>= 1;
    if (bit) {
        seed ^= 0xB400;
    }
    return seed;
}

static void scatter(uint8_t density) {
    for (uint8_t y = 0; y < HEIGHT; y++) {
        for (uint8_t x = 0; x < WIDTH; x++) {
            cells[y][x] = (random16() & 0xFF) < density;
        }
    }
}

static uint8_t neighbours(uint8_t x, uint8_t y) {
    uint8_t count = 0;
    for (int8_t dy = -1; dy <= 1; dy++) {
        for (int8_t dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) {
                continue;
            }
            uint8_t nx = (uint8_t)((x + WIDTH + dx) % WIDTH);
            uint8_t ny = (uint8_t)((y + HEIGHT + dy) % HEIGHT);
            count += cells[ny][nx];
        }
    }
    return count;
}

static void step(void) {
    for (uint8_t y = 0; y < HEIGHT; y++) {
        for (uint8_t x = 0; x < WIDTH; x++) {
            uint8_t n = neighbours(x, y);
            next[y][x] = n == 3 || (n == 2 && cells[y][x]);
        }
    }
    memcpy(cells, next, sizeof cells);
    generation++;
}

static void draw(void) {
    uint8_t colour = (uint8_t)(0x1C + (generation & 0x03) * 0x20);
    for (uint8_t y = 0; y < HEIGHT; y++) {
        volatile uint8_t *row = SCREEN + (uint16_t)y * 2 * 192;
        for (uint8_t x = 0; x < WIDTH; x++) {
            uint8_t pixel = cells[y][x] ? colour : 0;
            row[x * 2] = pixel;
            row[x * 2 + 1] = pixel;
            row[192 + x * 2] = pixel;
            row[192 + x * 2 + 1] = pixel;
        }
    }
}

int main(void) {
    scatter(80);
    for (;;) {
        uint8_t buttons = BUTTONS;
        if (buttons & 0x10) {
            scatter(80);
        } else if (buttons & 0x20) {
            memset(cells, 0, sizeof cells);
        }
        step();
        draw();
    }
}
