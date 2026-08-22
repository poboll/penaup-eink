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
 * FileName : /film_hal/src/hal_init.c
 * Author: Kiritro  Version: v0.1  Date: 2026/4/1
 * Description: Function introduction
 * ChangeLog: Change Notes
 *
 *********************************************************************/

/*********************************************************************
 * INCLUDES
 */
#include "hal_sd.h"
#include "hal_bat.h"
#include "hal_led.h"
#include "hal_pwr.h"
#include "hal_epd.h"
#include "hal_input.h"
#include "hal_init.h"

#include "sys_log.h"

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


void film_hal_init(void)
{
    // 初始化电源
    hal_pwr_init();
    // 初始化电池
    hal_bat_init();
    // 初始化RGB LED
    hal_led_init();
    // 初始化SD卡
    hal_sd_init();
    // 初始化输入设备
    hal_input_init();
    // 初始化EPD
    hal_epd_init();
}
