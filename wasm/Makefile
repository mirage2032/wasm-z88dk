#------------------------------------------------------------------------------
# z88dk for WebAssembly
#
# Builds zcc and the tools it runs to compile C for the Z80 (ucpp, zpragma,
# sccz80, copt, z80asm, and GNU m4 for the start-up code), plus astyle, each as
# an Emscripten ES module, and packs the libraries and headers they read.
# z88dk.mjs runs them like processes on one shared in-memory filesystem: see
# README.md.
#
#   make                        the tools, in build/bin
#   make pack  Z88DK=/opt/z88dk the libraries and headers, from a built z88dk
#   make dist  Z88DK=/opt/z88dk what a page serves, in build/dist
#   make check Z88DK=/opt/z88dk Z88DK_IMAGE=z88dk/z88dk@sha256:…
#                               compiles test/programs natively and here, and
#                               compares everything they made
#
# Needs emsdk (emcc on the PATH, and its Node), and curl, tar, xz, bzip2 and
# sha256sum for m4 and astyle; `check` needs Docker.
#------------------------------------------------------------------------------

EMCC		?= emcc
EMXX		?= em++
EMCONFIGURE	?= emconfigure
EMMAKE		?= emmake
# Node runs the build's scripts: emsdk's own. Found through its environment,
# else in its install, since `node` alone can name the directory emsdk puts on
# the PATH (make, unlike sh, then stops).
NODE		?= $(or $(EMSDK_NODE),$(firstword $(wildcard $(EMSDK)/node/*/bin/node)),node)
DOCKER		?= docker

ROOT		:= $(abspath ..)
SRC		:= $(ROOT)/src
EXT		:= $(ROOT)/ext
BUILD		:= $(abspath build)
OBJ		:= $(BUILD)/obj
BIN		:= $(BUILD)/bin
PACKS		:= $(BUILD)/packs
DIST		:= $(BUILD)/dist
CHECK		:= $(BUILD)/check
DOWNLOADS	:= $(BUILD)/downloads

# A z88dk whose libraries were built natively from the same commit, such as
# z88dk's Docker image of it: the packs take its lib/, include/ and libsrc/
# files (pack.sh). `check` compiles with that image.
Z88DK		?= /opt/z88dk
Z88DK_IMAGE	?= z88dk/z88dk

# zcc prints this; sccz80 puts it in the code it writes.
Z88DK_VERSION	?= $(shell git -C $(ROOT) rev-parse --short=10 HEAD 2>/dev/null || echo unknown)-wasm

OPT		?= -O2
# Source paths (in assertions' messages) relative to the tree, so the same
# sources make the same files wherever they're built.
CFLAGS		:= $(OPT) -Wno-everything -ffile-prefix-map=$(ROOT)/=
CXXFLAGS	:= $(OPT) -Wno-everything -ffile-prefix-map=$(ROOT)/=

# Every tool is an ES module exporting a factory. Instantiating it runs main()
# synchronously, on a fresh instance: a process. -sWASM_ASYNC_COMPILATION=0 is
# what makes that synchronous, so zcc's system() can wait for the tool it
# starts. The filesystem is shared through PROXYFS (see z88dk.mjs).
LDFLAGS		:= $(OPT) \
		   -sMODULARIZE=1 -sEXPORT_ES6=1 \
		   -sENVIRONMENT=web,worker \
		   -sWASM_ASYNC_COMPILATION=0 \
		   -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=128MB \
		   -sSTACK_SIZE=4MB \
		   -sEXIT_RUNTIME=1 \
		   -sFORCE_FILESYSTEM=1 -lproxyfs.js \
		   -sEXPORTED_RUNTIME_METHODS=FS,PROXYFS,ENV \
		   -sINCOMING_MODULE_JS_API=arguments,thisProgram,preRun,print,printErr,stdin,wasmBinary,onExit,onAbort,noInitialRun

TOOLS		:= zcc z88dk-ucpp z88dk-zpragma z88dk-sccz80 z88dk-copt z88dk-z80asm m4 astyle

# Not part of z88dk: GNU m4, which zcc runs on the start-up code, and astyle,
# which formats C. Release tarballs, checked against these hashes.
M4_VERSION	:= 1.4.19
M4_SHA256	:= 63aede5c6d33b6d9b13511cd0be2cac046f2e70fd0a07aa9573a04a82783af96
M4_URLS		:= https://ftp.gnu.org/gnu/m4/m4-$(M4_VERSION).tar.xz \
		   http://archive.ubuntu.com/ubuntu/pool/main/m/m4/m4_$(M4_VERSION).orig.tar.xz
M4_TARBALL	:= $(DOWNLOADS)/m4-$(M4_VERSION).tar.xz

ASTYLE_VERSION	:= 3.6.19
ASTYLE_SHA256	:= ae5ef4ddf1f88288bcc8f6d53266707f80a81fcc6decf4da5fe5c8e420a0ab1c
ASTYLE_URLS	:= https://downloads.sourceforge.net/project/astyle/astyle/astyle%203.6/astyle-$(ASTYLE_VERSION).tar.bz2
ASTYLE_TARBALL	:= $(DOWNLOADS)/astyle-$(ASTYLE_VERSION).tar.bz2

.PHONY: all tools pack dist check clean
all: tools
tools: $(TOOLS:%=$(BIN)/%.mjs)

#------------------------------------------------------------------------------
# What's made of the tools
#------------------------------------------------------------------------------

# The libraries, headers and start-up code `zcc +z80 -clib=new` reads, from a
# z88dk built natively from the same commit (pack/z80-newlib.list).
pack: $(PACKS)/z80-newlib.tar
$(PACKS)/%.tar: pack/%.list pack.sh
	@mkdir -p $(@D)
	./pack.sh $(Z88DK) $< $@

# What a page serves (see worker.mjs), with its manifest.json, and what has
# to go with it: the licences, and m4's source (GPL; see NOTICE.txt).
dist: tools pack $(M4_TARBALL)
	rm -rf $(DIST)
	$(NODE) dist.mjs $(BIN) $(PACKS) $(DIST) $(TOOLS)
	cp NOTICE.txt $(M4_TARBALL) $(DIST)/

# Compiles test/programs with a native z88dk of the same commit (its Docker
# image) and with build/dist, then compares all they made: it must match. Then
# the programs a native z88dk never finishes must stop here (test/limits.mjs).
check: dist
	rm -rf $(CHECK) && mkdir -p $(CHECK)/native
	$(DOCKER) run --rm --entrypoint sh -v $(CURDIR)/test:/test:ro -v $(CHECK)/native:/out \
		$(Z88DK_IMAGE) /test/native.sh /test/programs /out
	$(NODE) test/wasm.mjs $(DIST) test/programs $(CHECK)/wasm
	test/compare.sh $(CHECK)/native $(CHECK)/wasm
	$(NODE) test/limits.mjs $(DIST)

#------------------------------------------------------------------------------
# z88dk's tools, from its sources
#------------------------------------------------------------------------------

# The tools include it as "../config.h"; the top-level Makefile makes it the
# same way for a native build.
$(SRC)/config.h:
	echo '#define PREFIX "/opt/z88dk"' > $@
	echo '#define BINDIR "/opt/z88dk/bin"' >> $@
	echo '#define UNIX 1' >> $@
	echo '#define Z88DK_VERSION "$(Z88DK_VERSION)"' >> $@

# $(call objs,tool,sources): the objects for sources, under $(OBJ)/tool.
objs = $(patsubst $(ROOT)/%,$(OBJ)/$(1)/%.o,$(2))

define TOOL
$(1)_OBJS := $$(call objs,$(1),$$($(1)_SRCS))
$$(OBJ)/$(1)/%.c.o: $$(ROOT)/%.c | $$(SRC)/config.h
	@mkdir -p $$(@D)
	$$(EMCC) $$(CFLAGS) $$($(1)_CFLAGS) -c -o $$@ $$<
$$(OBJ)/$(1)/%.cpp.o: $$(ROOT)/%.cpp | $$(SRC)/config.h
	@mkdir -p $$(@D)
	$$(EMXX) $$(CXXFLAGS) $$($(1)_CXXFLAGS) -c -o $$@ $$<
$$(BIN)/$(1).mjs: $$($(1)_OBJS) $$($(1)_DEPS)
	@mkdir -p $$(@D)
	$$(EMXX) $$(LDFLAGS) $$($(1)_LDFLAGS) -o $$@ $$($(1)_OBJS)
endef

# Each tool's sources and flags, as in its own Makefile under src/.
REGEX_COPT	:= $(addprefix $(SRC)/copt/regex/,regcomp.c regerror.c regexec.c regfree.c)

zcc_SRCS	:= $(SRC)/zcc/zcc.c $(REGEX_COPT) $(SRC)/common/dirname.c $(SRC)/common/option.c
zcc_CFLAGS	:= -DLOCAL_REGEXP -I$(SRC)/zcc -I$(SRC)/copt -I$(SRC)/common -I$(EXT)/uthash/src
zcc_LDFLAGS	:= --js-library $(CURDIR)/system.js
zcc_DEPS	:= system.js

z88dk-ucpp_SRCS	:= $(addprefix $(SRC)/ucpp/,mem.c nhash.c cpp.c lexer.c assert.c macro.c eval.c)
z88dk-ucpp_CFLAGS := -std=gnu11 -I$(EXT)/optparse -I$(EXT)/regex -DSTAND_ALONE -DUCPP_CONFIG

z88dk-zpragma_SRCS := $(wildcard $(SRC)/zpragma/*.c)
z88dk-zpragma_CFLAGS := -std=gnu11 -I$(EXT)/optparse -I$(EXT)/regex

z88dk-sccz80_SRCS := $(addprefix $(SRC)/sccz80/,callfunc.c cdbfile.c codegen.c const.c data.c \
		     declinit.c error.c expr.c goto.c io.c lex.c main.c misc.c plunge.c preproc.c \
		     primary.c stmt.c sym.c while.c declparse.c) $(SRC)/common/option.c
z88dk-sccz80_CFLAGS := -std=gnu99 -I$(SRC)/common -I$(EXT)/uthash/src

z88dk-copt_SRCS	:= $(SRC)/copt/copt.c $(REGEX_COPT)
z88dk-copt_CFLAGS := -std=gnu99 -DLOCAL_REGEXP -I$(SRC)/copt

Z80ASM		:= $(SRC)/z80asm
# Its parser, reshaped so V8 can optimise it (parse_actions.mjs): parse1.c is
# compiled from a copy beside the reshaped parse_rules.h it includes.
Z80ASM_GEN	:= $(BUILD)/gen/z80asm
z88dk-z80asm_SRCS := $(filter-out $(Z80ASM)/src/c/test.c $(Z80ASM)/src/c/parse1.c,$(wildcard $(Z80ASM)/src/c/*.c)) \
		     $(Z80ASM_GEN)/parse1.c \
		     $(wildcard $(SRC)/common/*.c) $(wildcard $(EXT)/regex/reg*.c) \
		     $(wildcard $(Z80ASM)/src/*.cpp $(Z80ASM)/src/cpp/*.cpp)
z88dk-z80asm_CFLAGS := -std=gnu11 -I$(Z80ASM) -I$(Z80ASM)/src -I$(SRC)/common -I$(Z80ASM)/src/c \
		     -I$(Z80ASM)/t -I$(EXT)/optparse -I$(EXT)/regex -I$(EXT)/uthash/src
z88dk-z80asm_CXXFLAGS := -std=gnu++17 -I$(Z80ASM) -I$(Z80ASM)/src -I$(SRC)/common -I$(Z80ASM)/src/cpp

$(foreach tool,zcc z88dk-ucpp z88dk-zpragma z88dk-sccz80 z88dk-copt z88dk-z80asm,$(eval $(call TOOL,$(tool))))

$(Z80ASM_GEN)/parse1.c: $(Z80ASM)/src/c/parse1.c $(Z80ASM)/src/c/parse_rules.h parse_actions.mjs
	@mkdir -p $(@D)
	$(NODE) parse_actions.mjs $(Z80ASM)/src/c/parse_rules.h $(Z80ASM_GEN)/parse_rules.h
	cp $(Z80ASM)/src/c/parse1.c $@

#------------------------------------------------------------------------------
# m4 and astyle, from their release tarballs
#------------------------------------------------------------------------------

# $(call fetch,file,sha256,urls): the first URL whose download has that hash.
define fetch
	@mkdir -p $(DOWNLOADS)
	@for url in $(3); do \
		echo "fetching $$url"; \
		curl -fsSL --retry 3 -o $(1).part "$$url" \
		&& echo "$(2)  $(1).part" | sha256sum -c --quiet - \
		&& mv $(1).part $(1) && exit 0; \
		rm -f $(1).part; \
	done; echo "no source for $(notdir $(1)) matched $(2)" >&2; exit 1
endef

$(M4_TARBALL):
	$(call fetch,$@,$(M4_SHA256),$(M4_URLS))

$(ASTYLE_TARBALL):
	$(call fetch,$@,$(ASTYLE_SHA256),$(ASTYLE_URLS))

# m4: configured for Emscripten as a cross-compile, so configure guesses
# rather than running its test programs (under emconfigure they run in Node,
# and some, like the one for nanosleep, never finish), then linked as the
# other tools are. Native Language Support, threads and the stack-overflow
# handler (libsigsegv) are left out: none can work here, and the start-up code
# needs none of them.
M4_SRC		:= $(BUILD)/m4-$(M4_VERSION)
# Emscripten's <sys/random.h> uses size_t without including <stddef.h>, which
# gnulib's getrandom.c doesn't include first.
M4_CPPFLAGS	:= -include stddef.h

$(M4_SRC)/config.status: $(M4_TARBALL)
	rm -rf $(M4_SRC) && mkdir -p $(M4_SRC)
	tar -xJf $< -C $(M4_SRC) --strip-components=1
	cd $(M4_SRC) && $(EMCONFIGURE) ./configure \
		--build=$$(sh build-aux/config.guess) --host=wasm32-unknown-emscripten \
		--disable-nls --disable-threads --without-libsigsegv --disable-assert \
		CFLAGS="$(OPT) -ffile-prefix-map=$(M4_SRC)/=" CPPFLAGS="$(M4_CPPFLAGS)" > configure.log 2>&1 \
		|| { tail -40 configure.log; exit 1; }

$(BIN)/m4.mjs: $(M4_SRC)/config.status
	$(EMMAKE) $(MAKE) -C $(M4_SRC)/lib > $(M4_SRC)/make-lib.log 2>&1 \
		|| { tail -40 $(M4_SRC)/make-lib.log; exit 1; }
	$(EMMAKE) $(MAKE) -C $(M4_SRC)/src m4 > $(M4_SRC)/make-src.log 2>&1 \
		|| { tail -40 $(M4_SRC)/make-src.log; exit 1; }
	@mkdir -p $(@D)
	$(EMCC) $(LDFLAGS) -o $@ $(M4_SRC)/src/*.o $(M4_SRC)/lib/libm4.a

# astyle: its own build's flags (build/gcc/Makefile), for the program.
ASTYLE_SRC	:= $(BUILD)/astyle-$(ASTYLE_VERSION)
ASTYLE_FILES	:= astyle_main ASBeautifier ASFormatter ASEnhancer ASLocalizer ASResource

$(ASTYLE_SRC)/.unpacked: $(ASTYLE_TARBALL)
	rm -rf $(ASTYLE_SRC) && mkdir -p $(ASTYLE_SRC)
	tar -xjf $< -C $(ASTYLE_SRC) --strip-components=1
	touch $@

$(BIN)/astyle.mjs: $(ASTYLE_SRC)/.unpacked
	@mkdir -p $(OBJ)/astyle $(@D)
	for f in $(ASTYLE_FILES); do \
		$(EMXX) $(OPT) -DNDEBUG -fno-rtti -fno-exceptions -std=c++17 -ffile-prefix-map=$(ASTYLE_SRC)/= \
			-c -o $(OBJ)/astyle/$$f.o $(ASTYLE_SRC)/src/$$f.cpp || exit 1; \
	done
	$(EMXX) $(LDFLAGS) -o $@ $(ASTYLE_FILES:%=$(OBJ)/astyle/%.o)

clean:
	rm -rf $(OBJ) $(BIN) $(PACKS) $(DIST) $(CHECK) $(BUILD)/gen
