#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>

static char buffer[64];
uint16_t counter;

struct point { int x, y; };

static int compare(const void *a, const void *b) {
    return *(const int *)a - *(const int *)b;
}

int main(void) {
    int values[8] = {5, 3, 9, 1, 7, 2, 8, 6};
    struct point p = {3, 4};
    qsort(values, 8, sizeof(int), compare);
    sprintf(buffer, "%d,%d %u", p.x, p.y, (unsigned)strlen("hello"));
    counter = atoi("1234") + values[0];
    memset((void *)0x4000, 0xE0, 192 * 128);
    for (;;) {
        counter++;
    }
}
