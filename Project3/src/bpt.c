#include "bpt.h"

H_P * hp;

page * rt = NULL; //root is declared as global

int fd = -1; //fd is declared as global


H_P * load_header(off_t off) {
    H_P * newhp = (H_P*)calloc(1, sizeof(H_P));
    if (sizeof(H_P) > pread(fd, newhp, sizeof(H_P), 0)) {

        return NULL;
    }
    return newhp;
}


page * load_page(off_t off) {
    page* load = (page*)calloc(1, sizeof(page));
    //if (off % sizeof(page) != 0) printf("load fail : page offset error\n");
    if (sizeof(page) > pread(fd, load, sizeof(page), off)) {

        return NULL;
    }
    return load;
}

int open_table(char * pathname) {
    fd = open(pathname, O_RDWR | O_CREAT | O_EXCL | O_SYNC  , 0775); 
    hp = (H_P *)calloc(1, sizeof(H_P));
    if (fd > 0) {
        //printf("New File created\n");
        hp->fpo = 0;
        hp->num_of_pages = 1;
        hp->rpo = 0;
        pwrite(fd, hp, sizeof(H_P), 0);
        free(hp);
        hp = load_header(0);
        return 0;
    }
    fd = open(pathname, O_RDWR|O_SYNC);
    if (fd > 0) {
        //printf("Read Existed File\n");
        if (sizeof(H_P) > pread(fd, hp, sizeof(H_P), 0)) {
            return -1;
        }
        off_t r_o = hp->rpo;
        rt = load_page(r_o);
        return 0;
    }
    else return -1;
}

void reset(off_t off) {
    page * reset;
    reset = (page*)calloc(1, sizeof(page));
    reset->parent_page_offset = 0;
    reset->is_leaf = 0;
    reset->num_of_keys = 0;
    reset->next_offset = 0;
    pwrite(fd, reset, sizeof(page), off);
    free(reset);
    return;
}

void freetouse(off_t fpo) {
    page * reset;
    reset = load_page(fpo);
    reset->parent_page_offset = 0;
    reset->is_leaf = 0;
    reset->num_of_keys = 0;
    reset->next_offset = 0;
    pwrite(fd, reset, sizeof(page), fpo);
    free(reset);
    return;
}

void usetofree(off_t wbf) {
    page * utf = load_page(wbf);
    utf->parent_page_offset = hp->fpo;
    utf->is_leaf = 0;
    utf->num_of_keys = 0;
    utf->next_offset = 0;
    pwrite(fd, utf, sizeof(page), wbf);
    free(utf);
    hp->fpo = wbf;
    pwrite(fd, hp, sizeof(hp), 0);
    free(hp);
    hp = load_header(0);
    return;
}

off_t new_page() {
    off_t newp;
    page * np;
    off_t prev;
    if (hp->fpo != 0) {
        newp = hp->fpo;
        np = load_page(newp);
        hp->fpo = np->parent_page_offset; //헤더페이지 업데이트해서 프리페이지 리스트 유지.
        pwrite(fd, hp, sizeof(hp), 0);
        free(hp);
        hp = load_header(0);
        free(np);
        freetouse(newp);
        return newp;
    }
    //change previous offset to 0 is needed
    newp = lseek(fd, 0, SEEK_END);
    //if (newp % sizeof(page) != 0) printf("new page made error : file size error\n");
    reset(newp);
    hp->num_of_pages++; //파일의 끝에 새 페이지를 추가한 것이므로 페이지수 업데이트
    pwrite(fd, hp, sizeof(H_P), 0);
    free(hp);
    hp = load_header(0);
    return newp;
}



int cut(int length) {
    if (length % 2 == 0)
        return length / 2;
    else
        return length / 2 + 1;
}



void start_new_file(record rec) {

    page * root;
    off_t ro;
    ro = new_page();
    rt = load_page(ro);
    hp->rpo = ro;
    pwrite(fd, hp, sizeof(H_P), 0);
    free(hp);
    hp = load_header(0);
    rt->num_of_keys = 1;
    rt->is_leaf = 1;
    rt->records[0] = rec;
    pwrite(fd, rt, sizeof(page), hp->rpo);
    free(rt);
    rt = load_page(hp->rpo);
    //printf("new file is made\n");
}


// 리프 노드를 찾는 함수
page * find_leaf(off_t root_offset, int64_t key, off_t *leaf_offset) {
    page *current = load_page(root_offset); // 루트 페이지 로드
    off_t current_offset = root_offset;
    int i;

    // 트리가 비어 있으면 NULL 반환
    if (current == NULL) {
        return NULL;
    }

    // 리프 노드에 도달할 때까지 탐색
    while (!current->is_leaf) {
        i = 0;

        // V <= C.Ki 조건을 만족하는 가장 작은 i를 찾음
        while (i < current->num_of_keys && key >= current->b_f[i].key) {
            i++;
        }

        // 다음 페이지로 이동
        off_t next_page_offset = (i == current->num_of_keys) 
            ? current->next_offset 
            : current->b_f[i].p_offset;

        free(current);  // 이전 노드 메모리 해제
        current = load_page(next_page_offset); // 다음 노드 로드
        current_offset = next_page_offset;    // 현재 오프셋 갱신
    }

    // 리프 노드의 디스크 오프셋 반환
    *leaf_offset = current_offset;
    return current;
}


// 키를 찾는 함수
char * db_find(int64_t key) {
    // 루트가 없는 경우 NULL 반환
    if (hp == NULL || hp->rpo == 0) {
        return NULL;
    }

    // 리프 노드를 찾음
    off_t leaf_offset;
    page *leaf = find_leaf(hp->rpo, key, &leaf_offset);

    // 리프 노드가 NULL이면 키가 없음
    if (leaf == NULL) {
        return NULL;
    }

    // 리프 노드에서 키를 검색
    for (int i = 0; i < leaf->num_of_keys; i++) {
        if (leaf->records[i].key == key) {
            // 값을 복사하여 반환
            char * result = (char *)calloc(1, 120);
            strcpy(result, leaf->records[i].value);
            free(leaf); // 메모리 해제
            return result;
        }
    }

    // 키를 찾지 못했으면 NULL 반환
    free(leaf);
    return NULL;
}

int insert_into_leaf(page *leaf, int64_t key, const char *value) {
    // 삽입 위치를 찾기 위한 변수
    int i, insertion_point = 0;

    // 삽입 위치 탐색
    while (insertion_point < leaf->num_of_keys && leaf->records[insertion_point].key < key) {
        insertion_point++;
    }

    // 기존 데이터를 오른쪽으로 이동하여 삽입 공간 확보
    for (i = leaf->num_of_keys; i > insertion_point; i--) {
        leaf->records[i] = leaf->records[i - 1];
    }

    // 새로운 키와 값을 삽입
    leaf->records[insertion_point].key = key;
    strncpy(leaf->records[insertion_point].value, value, sizeof(leaf->records[insertion_point].value) - 1);
    leaf->records[insertion_point].value[sizeof(leaf->records[insertion_point].value) - 1] = '\0';

    // 키 개수 증가
    leaf->num_of_keys++;

    return 0; // 성공
}

int key_rotation_insert(int64_t key, char* value, page* leaf, page* sibling, off_t leaf_offset) {
    // Step 1: 임시 배열 생성 및 데이터 복사
    record temp_records[LEAF_MAX + 1]; // 임시 배열 (최대 32개 키 저장 가능)
    int temp_keys = LEAF_MAX;

    // 기존 leaf 노드의 키와 값을 임시 배열에 복사시켜주자. 일단 insert하는 key값은 안들어간다.
    for (int i = 0; i < leaf->num_of_keys; i++) {
        temp_records[i] = leaf->records[i];
    }

    // insert해줘야 하는 키 값을 넣어줘야 하는 위치를 찾는다.
    int insertion_point = 0;
    while (insertion_point < temp_keys && temp_records[insertion_point].key < key) {
        insertion_point++;
    }

    // 찾은 위치 이후의 key들은 한칸씩 뒤로 옮기기
    for (int i = temp_keys; i > insertion_point; i--) {
        temp_records[i] = temp_records[i - 1];
    }

    // insert하는 key값 넣어주고, value도 같이 넣어준다. value는 문자열 배열이여서 안전하게 복사해주기 위해 아래와 같이 복사.
    temp_records[insertion_point].key = key;
    strncpy(temp_records[insertion_point].value, value, sizeof(temp_records[insertion_point].value) - 1);
    temp_records[insertion_point].value[sizeof(temp_records[insertion_point].value) - 1] = '\0';
    temp_keys++;

    // temp_records에서 가장 큰 값을 sibling의 왼쪽으로 옮긴다. sibling의 기존 키들은 모두 한칸씩 오른쪽으로.
    sibling->num_of_keys++;
    for (int i = sibling->num_of_keys - 1; i > 0; i--) {
        sibling->records[i] = sibling->records[i - 1 ];
    }
    sibling->records[0] = temp_records[temp_keys - 1]; // 가장 큰 키를 sibling으로 이동
    temp_keys--; // 임시 배열에서 가장 큰 키 제거

    // 다시 temp_records를 leaf로 옯겨준다.
    leaf->num_of_keys = temp_keys;
    for (int i = 0; i < temp_keys; i++) {
        leaf->records[i] = temp_records[i];
    }
     

    // Step 5: 부모 노드 업데이트
    off_t parent_offset = leaf->parent_page_offset;
    if (parent_offset != 0) {
        page *parent = load_page(parent_offset);
        if (parent == NULL) {
            printf("Error: Failed to load parent node.\n");
            return -1;
        }

         // leaf와 sibling이 부모의 어떤 키로 연결되었는지 찾음
        int parent_key_index = 0;
        while (parent_key_index < parent->num_of_keys &&
               parent->b_f[parent_key_index].p_offset != leaf_offset) {
                   parent_key_index++;
               }

      
       
        parent->b_f[parent_key_index].key = sibling->records[0].key;
        // sibling의 첫 번째 키로 업데이트
  

        // 부모 노드 디스크에 저장
        if (pwrite(fd, parent, sizeof(page), parent_offset) != sizeof(page)) {
            printf("Error: Failed to write parent node to disk.\n");
            free(parent);
            return -1;
        }

        free(parent);
    }

    // Step 6: 변경된 노드들을 디스크에 저장
    if (pwrite(fd, leaf, sizeof(page), leaf_offset) != sizeof(page) ||
        pwrite(fd, sibling, sizeof(page), leaf->next_offset) != sizeof(page)) {
        printf("Error: Failed to write updated nodes to disk.\n");
        return -1;
    }
    return 0; // 성공
}



int db_insert(int64_t key, char * value) {
    if (hp == NULL) {
        printf("Error: Header page not initialized.\n");
        return -1;
    }

    // 트리가 비어 있는 경우 새로운 루트를 생성
    if (hp->rpo == 0) {       
        // 새로운 루트를 생성
        off_t root_offset = new_page();
        page *root = load_page(root_offset);
        if (root == NULL) {
            printf("Error: Failed to create new root.\n");
            return -1;
        }

        // 루트 노드 초기화
        root->is_leaf = 1; // 루트는 리프 노드로 초기화
        root->num_of_keys = 1; 
        root->records[0].key = key; // 키 설정
        strncpy(root->records[0].value, value, sizeof(root->records[0].value) - 1);
        root->records[0].value[sizeof(root->records[0].value) - 1] = '\0'; // 문자열 종료
        root->next_offset = 0; // 리프 노드의 next_offset 초기화
        root->parent_page_offset = 0; // 루트의 부모 없음

        // 헤더 페이지 갱신
        hp->rpo = root_offset;
        if (pwrite(fd, hp, sizeof(H_P), 0) != sizeof(H_P)) {
            printf("Error: Failed to update header page.\n");
            free(root);
            return -1;
        }

        // 루트 노드 디스크에 저장
        if (pwrite(fd, root, sizeof(page), root_offset) != sizeof(page)) {
            printf("Error: Failed to write new root to disk.\n");
            free(root);
            return -1;
        }

        free(root);
        return 0; // 성공적으로 삽입 완료
    }
    off_t leaf_offset;
    page *leaf = find_leaf(hp->rpo, key, &leaf_offset);
    //key가 들어갈수 있는 leaf노드를 찾는다.
    if (leaf == NULL) {
        printf("Error: Failed to find leaf node.\n");
        return -1;
    }
    for (int i = 0; i < leaf->num_of_keys; i++) {
        if (leaf->records[i].key == key) {
            printf("Error: Key %ld already exists. Insertion aborted.\n", key);
            free(leaf);
            return -1;
        }
    }

    // leaf노드에 이미 최대개수 이상의 key가 있을때 일반적인 삽입이 아닌, split또는 key rotation insert가 필요하다.
    if (leaf->num_of_keys >= LEAF_MAX) {
        // 리프 노드가 가득 찬 경우 처리
        // Step 3-1: 오른쪽 sibling 노드 확인
        if (leaf->next_offset == 0) {
            // 오른쪽 sibling 노드가 없는 경우 -> Split 필요
            int result = split_leaf(key, value, leaf, leaf_offset); 
            free(leaf); // split_leaf 내부에서 사용한 뒤 해제
            return result;
        } else {
            // 오른쪽 sibling 노드 로드
            page *sibling = load_page(leaf->next_offset);
            if (sibling == NULL) {
                printf("Error: Failed to load right sibling node.\n");
                free(leaf);
                return -1;
            }

            if (sibling->num_of_keys >= LEAF_MAX) {
                // 오른쪽 sibling 노드가 가득 찬 경우 -> Split 필요
                int result = split_leaf(key, value, leaf, leaf_offset);
                free(leaf);
                free(sibling); 
                return result;
            } else {//오른쪽 sibling노드가 가득차있지 않은 경우 30이하의 key존재.
                // Key-Rotation Insert 수행
                int result = key_rotation_insert(key, value, leaf, sibling, leaf_offset);
                free(leaf);
                free(sibling);
                return result; 
            }
        }
    }

    // leaf노드가 덜 차있어서 삽입이 가능한 경우
    int result = insert_into_leaf(leaf, key, value);
    if (result != 0) {
        printf("Error: Failed to insert into leaf.\n");
        free(leaf);
        return -1;
    }

    // 변경된 리프 노드를 디스크에 저장
    if (pwrite(fd, leaf, sizeof(page), leaf_offset) != sizeof(page)) {
        printf("Error: Failed to write leaf node to disk.\n");
        free(leaf);
        return -1;
    } 

    free(leaf);
    return 0; // 성공
}
int split_leaf(int64_t key, const char *value, page *leaf, off_t leaf_offset) {
    off_t new_leaf_offset = new_page();
    page *new_leaf = load_page(new_leaf_offset);
    if (new_leaf == NULL) {
        printf("Error: Failed to create new leaf node.\n");
        return -1;
    }

    // 초기화
    new_leaf->is_leaf = 1; 
    new_leaf->parent_page_offset = leaf->parent_page_offset;
    // 임시 공간에 기존 키와 새로운 키를 모두 저장
    record temp_records[LEAF_MAX + 1];
    int temp_keys = 0;
    for (int i = 0; i < leaf->num_of_keys; i++) {//일단 기존의 키 모두 똑같이 저장
        temp_records[temp_keys++] = leaf->records[i];
    }

    // 새로운 키와 값을 삽입할 위치 탐색
    int insertion_point = 0;
    while (insertion_point < temp_keys && temp_records[insertion_point].key < key) {
        insertion_point++;
    }

    // 새로 넣을 key오른쪽 값들 위치 업데이트
    for (int i = temp_keys; i > insertion_point; i--) {
        temp_records[i] = temp_records[i - 1];
    }
    //새로운 키와 value를 넣어줌.
    temp_records[insertion_point].key = key;
    strncpy(temp_records[insertion_point].value, value, sizeof(temp_records[insertion_point].value) - 1);
    temp_records[insertion_point].value[sizeof(temp_records[insertion_point].value) - 1] = '\0';
    temp_keys++;
    
    
    

    int split_index = cut(LEAF_MAX); 
    //기존 리프 노드 갱신 (왼쪽 절반 유지)
    leaf->num_of_keys = split_index;
    for (int i = 0; i < split_index; i++) {
        leaf->records[i] = temp_records[i];
    }

    //  새 리프 노드 채우기 (오른쪽 절반 이동)
    new_leaf->num_of_keys = temp_keys - split_index;
    for (int j = split_index; j < temp_keys; j++) {
        new_leaf->records[j-split_index] = temp_records[j];
    }

    //  리프 노드 간 연결
    new_leaf->next_offset = leaf->next_offset;
    leaf->next_offset = new_leaf_offset;

    //부모노드 업데이트 부분 해줘야함.
    //부모 노드에 insert하는 함수 구현 필요.
    //split해줘야 하는 부모 노드가 root면 새 root만들어줘야함.
    int64_t new_key = new_leaf->records[0].key; // 새 노드의 첫 번째 키
    if (insert_into_parent(leaf, new_key, new_leaf, leaf_offset, new_leaf_offset) != 0) {
        printf("Error: Failed to insert into parent.\n");
        free(new_leaf);
        return -1;
    }

    // Step 8: 디스크에 변경 사항 저장
    if (pwrite(fd, leaf, sizeof(page), leaf_offset) != sizeof(page) ||
        pwrite(fd, new_leaf, sizeof(page), new_leaf_offset) != sizeof(page)) {
        printf("Error: Failed to write split leaf nodes to disk.\n");
        free(new_leaf);
        return -1;
    }

    free(new_leaf);
    return 0; // 성공

}

int insert_into_parent(page *left, int64_t key, page *right, off_t left_offset, off_t right_offset) {
    off_t parent_offset = left->parent_page_offset;

    // 부모가 없는 경우 새로운 루트 생성
    if (parent_offset == 0) {
        return create_new_root(left, key, right, left_offset, right_offset);
    }

    page *parent = load_page(parent_offset);
    if (parent == NULL) {
        printf("Error: Failed to load parent node.\n");
        return -1;
    }

    //  부모 노드에서 삽입 위치 탐색
    int insertion_point = 0;
    while (insertion_point < parent->num_of_keys &&
           parent->b_f[insertion_point].key < key) {
        insertion_point++;
    }

    //  부모가 가득 찬 경우 처리. 부모노드 split
    if (parent->num_of_keys >= INTERNAL_MAX) {
    	int result= split_internal(parent, key, left_offset, right_offset, parent_offset);
        free(parent);
        return result;
    }

    // 부모 노드에 새로운 Key-Offset 삽입
    for (int i = parent->num_of_keys; i > insertion_point; i--) {
        parent->b_f[i] = parent->b_f[i - 1];
    }
    parent->b_f[insertion_point].key = key;
    parent->b_f[insertion_point].p_offset = left_offset;
    // parent노드에 올려준 key와 leaf노드 offset(left_offset)이 한쌍이다.
    // 그 다음 key와 new_leaf노드 offset(right_offset)이 한쌍이다.
    // 새로 올려준 key가 parent노드의 맨 오른쪽에 위치하는 경우 next_offset이 right_offset(new_leaf노드의 offset이 되어야 함)
    if (insertion_point == parent->num_of_keys) {
        parent->next_offset = right_offset; 
    } else {
        parent->b_f[insertion_point + 1].p_offset = right_offset;
    }

    parent->num_of_keys++;

    // 부모 노드 디스크에 저장
    if (pwrite(fd, parent, sizeof(page), parent_offset) != sizeof(page)) {
        printf("Error: Failed to write parent node to disk.\n");
        free(parent);
        return -1;
    }

    free(parent);
    return 0;
}

//internal page가 split이 필요할때
int split_internal(page *parent, int64_t key, off_t left_offset, off_t right_offset, off_t parent_offset) {
    // Step 1: 새 Internal 페이지 생성
    off_t new_internal_offset = new_page();
    page *new_internal = load_page(new_internal_offset);
    if (new_internal == NULL) {
        printf("Error: Failed to create new internal page.\n");
        return -1;
    }
    new_internal->is_leaf = 0; 
    new_internal->parent_page_offset = parent->parent_page_offset;

    // Step 2: 임시 공간에 기존 키, 포인터, 새로운 키 추가
    I_R temp_b_f[INTERNAL_MAX + 1];
    off_t temp_next_offset = parent->next_offset;

    int temp_keys = 0;
    for (int i = 0; i < parent->num_of_keys; i++) {
        temp_b_f[temp_keys++] = parent->b_f[i];
    }

    // 새로운 키와 포인터 삽입
    int insertion_point = 0;
    while (insertion_point < temp_keys && temp_b_f[insertion_point].key < key) {
        insertion_point++;
    }

    for (int i = temp_keys; i > insertion_point; i--) {
        temp_b_f[i] = temp_b_f[i - 1];
    }
    temp_b_f[insertion_point].key = key;
    temp_b_f[insertion_point].p_offset = left_offset;

    // Rightmost Case 처리
    if (insertion_point == temp_keys) {
        temp_next_offset = right_offset;
    } else {
        temp_b_f[insertion_point + 1].p_offset = right_offset;
    }
    temp_keys++;    
    //여기까지는 일반적인 부모 노드에 새로운 Key-Offset 삽입하는 코드와 동일하다. 부모 노드가 temp_b_f일뿐.

    // Split 지점 계산
    int split_index = temp_keys / 2;

    // Step 4: 기존 부모 노드 갱신 (왼쪽 절반 유지)
    parent->num_of_keys = split_index;
    for (int i = 0; i < split_index; i++) {
        parent->b_f[i] = temp_b_f[i];
    }
    parent->next_offset = temp_b_f[split_index].p_offset; 
    // 나눠지는 부분 이후의 p_offset이 parent의 next_offset이 될 것. ppt에서 아인슈타인 노드 부분. 

    // 오른쪽 부분으로 새 Internal 노드 채우기. 하나 빠질 것(copy가 아닌 move)이므로 -1해주는 것.
    new_internal->num_of_keys = temp_keys - split_index - 1;
    for (int i = split_index + 1, j = 0; i < temp_keys; i++, j++) {
        new_internal->b_f[j] = temp_b_f[i];
    }
    new_internal->next_offset = temp_next_offset;

    // 부모 노드에 새 키 삽입 요청
    int64_t new_key = temp_b_f[split_index].key; //ppt 31p의 gold부분 참고. 대충 맞는듯 한데 세밀한 검토 필요해 보인다...
    if (insert_into_parent(parent, new_key, new_internal, parent_offset, new_internal_offset) != 0) {
        printf("Error: Failed to insert into parent.\n");
        free(new_internal);
        return -1;
    }

    // Step 7: 디스크에 변경 사항 저장
    if (pwrite(fd, parent, sizeof(page), parent_offset) != sizeof(page) ||
        pwrite(fd, new_internal, sizeof(page), new_internal_offset) != sizeof(page)) {
        printf("Error: Failed to write split internal nodes to disk.\n");
        free(new_internal);
        return -1;
    }

    free(new_internal);
    return 0; // 성공
}


//부모노드가 없는 경우 새로운 루트 생성. 검토 필요함....
int create_new_root(page *left, int64_t key, page *right, off_t left_offset, off_t right_offset) {
    // 새 루트 페이지 생성
    off_t new_root_offset = new_page();
    page *new_root = load_page(new_root_offset);
    if (new_root == NULL) {
        printf("Error: Failed to create new root.\n");
        return -1;
    }

    // 새 루트 초기화
    new_root->is_leaf = 0;
    new_root->num_of_keys = 1;
    new_root->parent_page_offset = 0;
    new_root->b_f[0].key = key;
    new_root->b_f[0].p_offset = left_offset;
    new_root->next_offset = right_offset;

    // 기존 루트와 새 노드의 부모 설정
    left->parent_page_offset = new_root_offset;
    right->parent_page_offset = new_root_offset;

    // 헤더 페이지 갱신
    hp->rpo = new_root_offset;
    if (pwrite(fd, hp, sizeof(H_P), 0) != sizeof(H_P)) {
        printf("Error: Failed to update header page.\n");
        free(new_root);
        return -1;
    }

    // 디스크에 새 루트 저장
    if (pwrite(fd, new_root, sizeof(page), new_root_offset) != sizeof(page)) {
        printf("Error: Failed to write new root to disk.\n");
        free(new_root);
        return -1;
    }

    // 디스크에 기존 노드(left, right) 저장
    if (pwrite(fd, left, sizeof(page), left_offset) != sizeof(page)) {
        printf("Error: Failed to write left node to disk.\n");
        free(new_root);
        return -1;
    }

    if (pwrite(fd, right, sizeof(page), right_offset) != sizeof(page)) {
        printf("Error: Failed to write right node to disk.\n");
        free(new_root);
        return -1;
    }

    free(new_root);
    return 0;
}





int db_delete(int64_t key) {
      rt = load_page(hp->rpo);      
      if (hp == NULL || rt==NULL || rt->num_of_keys == 0) {
        printf("Error: Tree is empty.\n");
        return -1;
    }

    // 삭제할 키가 있는 리프 노드 찾기
    off_t leaf_offset;
    page *leaf = find_leaf(hp->rpo, key, &leaf_offset);

    if (leaf == NULL) {
        printf("Error: Key not found.\n");
        return -1;
    }
    // 리프 노드에서 키를 검색하여 삭제. 찾은 leaf에 key가 없을수도 있기때문에 이렇게 구현.
    for (int i = 0; i < leaf->num_of_keys; i++) {
        if (leaf->records[i].key == key) {
            delete_entry(leaf_offset, key);
            free(leaf);
            return 0;
        }
    }

    free(leaf);
    printf("Error: Key not found in leaf node.\n");
    return -1;
}//fin

page *remove_entry_from_node(page *n, int64_t key, off_t offset) {
    int i;

    // 뒤에 있던 것들 한칸씩 앞으로 땡긴다.
    if(n->is_leaf){
        for (i = 0; i < n->num_of_keys; i++){
            if (n->records[i].key == key){
                for (int j = i; j < n->num_of_keys - 1; j++) {
                    n->records[j] = n->records[j + 1];
                }
                break;
            }
        }
    }
    //internal페이지에서 어떤 값을 삭제시키는 상황인데 key와 p_offset이동이 동일하지 않게 움직인다.  
       //삭제되는 index가 둘이 다르기때문. key보다 p_offset의 인덱스가 1크다. 검토필요..
    else{ 
        for (i = 0; i < n->num_of_keys; i++){
            if (n->b_f[i].key == key) {
                for (int j = i; j < n->num_of_keys - 1; j++) {
                    n->b_f[j].key = n->b_f[j + 1].key;                 
                }
                for (int j = i+1; j < n->num_of_keys - 1; j++) {
                    n->b_f[j].p_offset = n->b_f[j + 1].p_offset;                 
                }
                break;
            }
        }
        if (i == n->num_of_keys - 1) {
            n->next_offset = n->b_f[n->num_of_keys - 1].p_offset;
        }
    }
    n->num_of_keys--;

    // Save the updated node back to disk
    if (pwrite(fd, n, sizeof(page), offset) != sizeof(page)) {
        printf("Error: Failed to write updated node to disk.\n");
        return NULL;
    }

    return n;
}

// node_offset은 없애야 하는 key가 위치한 leaf페이지의 offset
// 리프에서 키를 제거한 후, 필요하면 병합 또는 재분배를 통해 트리의 균형을 유지한다.
off_t delete_entry(off_t node_offset, int64_t key) {
    page *node = load_page(node_offset);
    // 해당 리프페이지(노드)에서 키를 제거
    remove_entry_from_node(node, key, node_offset);
    
    if (node_offset == hp->rpo) {
        free(node);
        return adjust_root(node_offset); //루트노드가 leaf인지 아닌지에 따라 나눠야 됨.
    }
    // 최소 키 개수를 만족하면 그대로 유지
    int min_keys = node->is_leaf ? cut(LEAF_MAX):cut(INTERNAL_MAX);
    if (node->num_of_keys >= min_keys) {
        free(node);
        return 0;
        //return hp->rpo;
    }

    // 최소 키 개수를 만족하지 못하면 병합 또는 재분배 필요
    off_t parent_offset = node->parent_page_offset;
    page *parent = load_page(parent_offset);

    // 이웃 노드의 인덱스를 탐색. 만약 leaf노드가 가장 왼쪽 노드였다면 -1저장. 뒤에서 오른쪽 노드넣어줄거임.
    // 만약 leaf노드가 가장 오른쪽 노드였다면 num_of_keys-1(오른쪽에서 두번째노드)저장.
    // 그외에는 leaf노드의 왼쪽 노드 인덱스가 저장.
    int neighbor_index = -1;
    if(parent->next_offset==node_offset){
        neighbor_index=parent->num_of_keys-1;
    }
    else{
        for (int i = 0; i < parent->num_of_keys; i++) {
            if (parent->b_f[i].p_offset == node_offset) {
                neighbor_index =  i - 1;
                break;
            }
        }
    }

    
    // leaf가 가장 왼쪽이었던 경우 제외하고는 leaf 왼쪽 node offset넣어줌.
    off_t neighbor_offset;
    if (neighbor_index == -1) {
         // 현재 노드가 부모의 가장 왼쪽 자식 노드인 경우
         if (parent->num_of_keys == 1) {
            // 부모의 키가 하나인 경우 -> 오른쪽 이웃은 parent->next_offset
             neighbor_offset = parent->next_offset;
        } else {
             // 부모의 키가 여러 개인 경우 -> 두 번째 포인터 사용
            neighbor_offset = parent->b_f[1].p_offset;
        }
    }  else {
        // 현재 노드가 부모의 왼쪽 이외의 자식인 경우
        neighbor_offset = parent->b_f[neighbor_index].p_offset;
     }
    page *neighbor = load_page(neighbor_offset);
    int64_t k_prime = neighbor_index == -1 ? parent->b_f[0].key : parent->b_f[neighbor_index].key;
    //k_prime은 leaf노드와 이웃노드를 연결하는 부모의 키.

    if (neighbor->num_of_keys + node->num_of_keys <=(node->is_leaf ? LEAF_MAX : INTERNAL_MAX)) {        // 이웃노드와의 개수를 합쳤는데 max이하면은 병합.
        return coalesce_nodes(node, neighbor, neighbor_index, k_prime, node_offset, neighbor_offset);
    } else {
        // 재분배 수행
        return redistribute_nodes(node, neighbor, neighbor_index, k_prime, node_offset, neighbor_offset);
    }

    free(node);
    free(neighbor);
    free(parent);

    return hp->rpo;
}

//없애준 값이 root페이지에 있었을때 호출.
off_t adjust_root(off_t root_offset) {
    page *root = load_page(root_offset);

    // 루트노드가 텅빈게 아니라면 그냥 냅둔다.
    if (root->num_of_keys > 0) {
        free(root);
        return root_offset;
    }

    off_t new_root_offset = 0;

    // 루트노드가 텅비었는데 그게 leaf노드라면 싹다 초기화.
    if (root->is_leaf) {
        free(rt);
        rt = NULL;
        usetofree(hp->rpo);
        hp->rpo = 0;
        pwrite(fd, hp, sizeof(hp), 0);
        free(hp);
        hp = load_header(0);
        return 0;
    } else {
        // 루트노드는 비었지만 루트노드가 internal노드면 child(왼쪽 child)를 새 root로 올리자.
        new_root_offset = root->b_f[0].p_offset;
        page *new_root = load_page(new_root_offset);
        new_root->parent_page_offset = 0;

        if (pwrite(fd, new_root, sizeof(page), new_root_offset) != sizeof(page)) {
            printf("Error: Failed to write new root to disk.\n");
            free(new_root);
            free(root);
            return -1;
        }

        free(new_root);
    }

    hp->rpo = new_root_offset;
    if (pwrite(fd, hp, sizeof(H_P), 0) != sizeof(H_P)) {
        printf("Error: Failed to update header page.\n");
        free(root);
        return -1;
    }

    free(root);
    return new_root_offset;
}

off_t coalesce_nodes(page *node, page *neighbor, int neighbor_index, int64_t k_prime, off_t node_offset, off_t neighbor_offset) {
    int i, j;
    off_t parent_offset = node->parent_page_offset;
    page *parent = load_page(parent_offset);

    if (neighbor_index == -1) {
        // 현재 노드가 가장 왼쪽 -> neighbor가 오른쪽 노드
        page *temp = node;
        node = neighbor;
        neighbor = temp;

        off_t temp_offset = node_offset;
        node_offset = neighbor_offset;
        neighbor_offset = temp_offset;
    }

    if (node->is_leaf) {
        // 리프 노드 병합
        for (i = neighbor->num_of_keys, j = 0; j < node->num_of_keys; i++, j++) {
            neighbor->records[i] = node->records[j];
        }
        neighbor->num_of_keys += node->num_of_keys;
        neighbor->next_offset = node->next_offset;
    } else {
        // 내부 노드 병합.. 좀 어렵다. 겈토 필요. 
        //
        neighbor->b_f[neighbor->num_of_keys].key = k_prime;
        neighbor->b_f[neighbor->num_of_keys].p_offset = neighbor->next_offset;
        neighbor->num_of_keys++;
        //바로 위에서 key개수를 업데이트해줬기 때문에 아래에서 i를 +1시켜줄 필요없다.
        for (i = neighbor->num_of_keys, j = 0; j < node->num_of_keys; i++, j++) {
            neighbor->b_f[i] = node->b_f[j];
        }
        neighbor->num_of_keys += node->num_of_keys;
        neighbor->next_offset = node->next_offset;
    }

    // 부모 노드에서 k_prime 제거
    delete_entry(parent_offset, k_prime);

    // 삭제된 노드를 free list로 이동
    usetofree(node_offset);

    // 병합된 neighbor를 디스크에 저장
    if (pwrite(fd, neighbor, sizeof(page), neighbor_offset) != sizeof(page)) {
        printf("Error: Failed to write merged neighbor to disk.\n");
    }

    free(node);
    free(neighbor);
    free(parent);

    return hp->rpo;
}

off_t redistribute_nodes(page *node, page *neighbor, int neighbor_index, int64_t k_prime, off_t node_offset, off_t neighbor_offset) {
    off_t parent_offset = node->parent_page_offset;
    page *parent = load_page(parent_offset);

    if (neighbor_index == -1) {
        // 오른쪽 neighbor에서 한 키를 가져옴
        if (node->is_leaf) {
            node->records[node->num_of_keys] = neighbor->records[0];
            node->num_of_keys++;
            for (int i = 0; i < neighbor->num_of_keys - 1; i++) {
                neighbor->records[i] = neighbor->records[i + 1];
            } //neighbor 맨 앞에 빠졌으니 한칸씩 앞으로 이동.
            //next_offset은 업데이트 해줄 필요없다.
            neighbor->num_of_keys--;
            parent->b_f[0].key = neighbor->records[0].key;
        } else {
            node->b_f[node->num_of_keys].key = k_prime;
            node->b_f[node->num_of_keys].p_offset = node->next_offset;
            node->next_offset = neighbor->b_f[0].p_offset;
            node->num_of_keys++;
            parent->b_f[0].key = neighbor->b_f[0].key; //node가 가장 왼쪽의 internalnode이므로 부모 첫번째키가 index키.

            for (int i = 0; i < neighbor->num_of_keys - 1; i++) {
                neighbor->b_f[i] = neighbor->b_f[i + 1];
            }
            neighbor->num_of_keys--;
        }
    } else {
        // 왼쪽 neighbor에서 한 키를 가져옴
        if (node->is_leaf) {
            for (int i = node->num_of_keys; i > 0; i--) {
                node->records[i] = node->records[i - 1];
            }
            node->records[0] = neighbor->records[neighbor->num_of_keys - 1];
            node->num_of_keys++;
            neighbor->num_of_keys--;
            parent->b_f[neighbor_index].key = node->records[0].key;
        } else {//ppt 33의 상황으로 이해하자. 
                //parent의 key로 부족해진 노드채우고 parent key에 neighbor의 마지막 키 옮겨준다.
            for (int i = node->num_of_keys; i > 0; i--) {
                node->b_f[i] = node->b_f[i - 1];
            }
            node->b_f[0].key = k_prime;
            node->b_f[0].p_offset = neighbor->next_offset;
            node->num_of_keys++;
            parent->b_f[neighbor_index].key = neighbor->b_f[neighbor->num_of_keys - 1].key;
            neighbor->num_of_keys--;
        }
    }

    // 변경된 노드와 부모를 디스크에 저장
    if (pwrite(fd, node, sizeof(page), node_offset) != sizeof(page)) {
        printf("Error: Failed to write redistributed node to disk.\n");
    }
    if (pwrite(fd, neighbor, sizeof(page), neighbor_offset) != sizeof(page)) {
        printf("Error: Failed to write redistributed neighbor to disk.\n");
    }
    if (pwrite(fd, parent, sizeof(page), parent_offset) != sizeof(page)) {
        printf("Error: Failed to write updated parent to disk.\n");
    }

    free(node);
    free(neighbor);
    free(parent);

    return hp->rpo;
}






