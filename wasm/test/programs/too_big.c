const unsigned char big[20000] = {1};
unsigned char ram[30000];
int main(void) { return big[0] + ram[0]; }
