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
 * FileName : /film_sys/src/sys_init.c
 * Author: Kiritro  Version: v0.1  Date: 2026/4/16
 * Description: Function introduction
 * ChangeLog: Change Notes
 *
 *********************************************************************/

/*********************************************************************
 * INCLUDES
 */
#include "sys_log.h"
#include "sys_init.h"

#include "hal_init.h"
#include "service_init.h"

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



void film_sys_init(void)
{
    // 抽象层初始化
    film_hal_init();
    // 服务层初始化
    film_service_init();
}
