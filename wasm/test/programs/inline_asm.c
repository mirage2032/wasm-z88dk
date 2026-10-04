#include <stdint.h>

uint8_t read_io(void) __naked {
#asm
    ld a, (0x3FFF)
    ld l, a
    ld h, 0
    ret
#endasm
}

void fill(uint8_t colour) {
    __asm__("di");
    for (uint16_t i = 0; i < 192 * 128; i++) {
        *((uint8_t *)0x4000 + i) = colour;
    }
    __asm__("ei");
}

int main(void) {
    while (1) {
        fill(read_io());
    }
}
