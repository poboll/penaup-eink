/*********************************************************************
 *
 * Historical source attribution:
 *   Original source: Copyright (c) 2026 kiritro
 *   Original source license: GPL-3.0-or-later
 *
 * Modifications and new material:
 *   Copyright (c) 2026 poboll
 *   LicenseRef-Poboll-NonCommercial
 *
 * Historical portions retain their original license until written
 * rights-transfer evidence is recorded. See LICENSE and docs/legal/provenance.md.
 *
 *
 * FileName : /film_service/src/service_init.c
 * Author: Kiritro  Version: v0.1  Date: 2026/4/16
 * Description: Function introduction
 * ChangeLog: Change Notes
 *
 *********************************************************************/

/*********************************************************************
 * INCLUDES
 */
#include "service_init.h"
#include "service_ble.h"
#include "service_param.h"
#include "service_monitor.h"
#include "service_file.h"
#include "service_film.h"
#include "service_wifi.h"


/*********************************************************************
 * MACROS
 */


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



void film_service_init(void)
{
    // 初始化服务参数
    service_param_init();
    // 初始化WiFi服务
    service_wifi_init();
    // 初始化ble服务
    service_ble_init();
    // 初始化监控服务
    service_monitor_init();
    // 初始化文件服务
    service_file_init();
    // 初始化照片服务
    service_film_init();
}
