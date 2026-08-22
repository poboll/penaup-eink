#ifndef __SYS_CFG_H__
#define __SYS_CFG_H__

#ifdef __cplusplus
extern "C" {
#endif

/*********************************************************************
 * INCLUDES
 */


/*********************************************************************
 * MACROS
 */
// SYS CONFIG
// 机型三选一。FRAMEFILM_* 是历史编译兼容宏，用户-facing 产品名为 Penaup。
// #define FRAMEFILM_STD        1          // 基础版
#define FRAMEFILM_PRO        1          // Pro 版（默认）
// #define FRAMEFILM_MAX        1          // Max 版
#ifndef FRAMEFILM_STD
#define FRAMEFILM_STD        0
#endif
#ifndef FRAMEFILM_PRO
#define FRAMEFILM_PRO        0
#endif
#ifndef FRAMEFILM_MAX
#define FRAMEFILM_MAX        0
#endif
#if (FRAMEFILM_STD + FRAMEFILM_PRO + FRAMEFILM_MAX) != 1
#error "机型配置错误：只能选择一个机型"
#endif

#if FRAMEFILM_STD == 1
#define SYS_DEVICE_NAME                "PENAUP"
#define SYS_MANUFACTURER_NAME          "POBOLL"
#endif
#if FRAMEFILM_PRO == 1
#define SYS_DEVICE_NAME                "PENAUPPRO"
#define SYS_MANUFACTURER_NAME          "POBOLL"
#endif
#if FRAMEFILM_MAX == 1
#define SYS_DEVICE_NAME                "PENAUPMAX"
#define SYS_MANUFACTURER_NAME          "POBOLL"
#endif

#define SYS_MODEL_NUMBER               "M1.0"
#define SYS_SERIAL_NUMBER              "FILM000001"             //SN号
#define SYS_HAREWARE_VERSION           "H1.0"                   //硬件版本号
#define SYS_FIRMWARE_VERSION           "1.0.0"                  //固件版本号
#define SYS_SYSTEM_ID                  "loveU"

// 保留旧 key，避免升级固件后丢失用户配置；不参与用户-facing 展示。
#define SYS_BLE_DEFAULT_KEY            "FRAMEFILM_KEY"

#define SYS_M_NVS_NAMESPACE            "FRAMEFILM_NVS"
#define SYS_M_NVS_KEY_NAME             "FILMKEY"

// spiffs
#define BACE_PATH                      "/spiffs"


/*********************************************************************
* TYPEDEFS
*/


/*********************************************************************
 * CONSTANTS
 */


/*********************************************************************
 * LOCAL VARIABLES
 */


/*********************************************************************
 * GLOBAL VARIABLES
 */


/*********************************************************************
 * LOCAL FUNCTIONS
 */


/*********************************************************************
 * GLOBAL FUNCTIONS
 */


#ifdef __cplusplus
extern "C"
}
#endif

#endif /* __SYS_CFG_H__ */
