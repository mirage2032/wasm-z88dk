#include <stdint.h>
#include <string.h>

typedef struct node {
    int16_t value;
    struct node *next;
} node_t;

static node_t pool[32];
static uint8_t used;
long accumulator = 0x12345678L;
typedef int (*op_t)(int, int);

static int add(int a, int b) { return a + b; }
static int sub(int a, int b) { return a - b; }
static int mul(int a, int b) { return a * b; }
static const op_t ops[] = { add, sub, mul };

static node_t *push(node_t *head, int16_t value) {
    if (used >= sizeof(pool) / sizeof(pool[0])) return head;
    node_t *n = &pool[used++];
    n->value = value;
    n->next = head;
    return n;
}

static int classify(int v) {
    switch (v & 7) {
    case 0: return 10;
    case 1: case 2: return 20;
    case 5: return ops[v % 3](v, 3);
    default: return -1;
    }
}

int main(void) {
    node_t *list = 0;
    for (int16_t i = 0; i < 20; i++) list = push(list, i * 3);
    int total = 0;
    for (node_t *n = list; n; n = n->next) total += classify(n->value);
    accumulator = accumulator * 3 / 7 + total;
    unsigned long big = (unsigned long)accumulator << 3;
    memcpy((void *)0x4000, &big, sizeof big);
    return (int)(big >> 16);
}
