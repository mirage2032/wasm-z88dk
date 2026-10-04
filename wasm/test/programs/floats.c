#include <math.h>
#include <stdint.h>

float scale = 1.5f;

int main(void) {
    uint8_t *screen = (uint8_t *)0x4000;
    for (int x = 0; x < 192; x++) {
        float y = 64.0f + 50.0f * sinf(x * 0.05f) * scale;
        int row = (int)y;
        if (row >= 0 && row < 128) {
            screen[row * 192 + x] = (uint8_t)(sqrtf((float)x) * 10.0f);
        }
    }
    double d = atan2(1.0, 2.0) + pow(2.0, 0.5) + floor(3.7) + fabs(-2.25);
    return (int)d;
}
