#pragma output CRT_STACK_SIZE = 256
#pragma printf = "%d %s"
#include <stdio.h>

char out[32];

int main(void) {
    sprintf(out, "%d %s", 42, "ok");
    return out[0];
}
