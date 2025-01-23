#ifndef __BPT_H__
#define __BPT_H__

// Uncomment the line below if you are compiling on Windows.
// #define WINDOWS
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdint.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <inttypes.h>
#include <string.h>
#define LEAF_MAX 31
#define INTERNAL_MAX 248

typedef struct record{
    int64_t key;
    char value[120];
}record;

typedef struct inter_record {
    int64_t key;
    off_t p_offset;
}I_R;

typedef struct Page{
    off_t parent_page_offset;
    int is_leaf;
    int num_of_keys;
    char reserved[104];
    off_t next_offset;
    union{
        I_R b_f[248];
        record records[31];
    };
}page;

typedef struct Header_Page{
    off_t fpo;
    off_t rpo;
    int64_t num_of_pages;
    char reserved[4072];
}H_P;


extern int fd;

extern page * rt;

extern H_P * hp;
// FUNCTION PROTOTYPES.
int open_table(char * pathname);
H_P * load_header(off_t off);
page * load_page(off_t off);

void reset(off_t off);
off_t new_page();
void freetouse(off_t fpo);
void usetofree(off_t wbf);  
int cut(int length);
int parser();
void start_new_file(record rec);

page * find_leaf(off_t root_offset, int64_t key, off_t *leaf_offset);
char * db_find(int64_t key);
int insert_into_leaf(page* leaf, int64_t key, const char *value);
int key_rotation_insert(int64_t key, char* value, page* leaf, page* sibling, off_t leaf_offset);
int db_insert(int64_t key, char * value);
int split_leaf(int64_t key, const char *value, page *leaf, off_t leaf_offset);
int insert_into_parent(page *leaf, int64_t key, page *right, off_t left_offset, off_t right_offset);
int split_internal(page *parent, int64_t key, off_t left_offset,off_t right_offset, off_t parent_offset);
int create_new_root(page *left, int64_t key, page *right, off_t left_offset, off_t right_offset);
int db_delete(int64_t key);
page *remove_entry_from_node(page *n, int64_t key, off_t offset);
off_t delete_entry(off_t node_offset, int64_t key);
off_t adjust_root(off_t root_offset);
off_t coalesce_nodes(page *node, page *neighbor, int neighbor_index, int64_t k_prime, off_t node_offset, off_t neighbor_offset);
off_t redistribute_nodes(page *node, page *neighbor, int neighbor_index, int64_t k_prime, off_t node_offset, off_t neighbor_offset);

#endif /* __BPT_H__*/


